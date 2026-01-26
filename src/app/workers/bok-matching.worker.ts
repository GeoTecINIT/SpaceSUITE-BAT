import { pipeline, PipelineType, ProgressCallback } from "@huggingface/transformers";

// Use the Singleton pattern to enable lazy construction of the pipeline.
class PipelineSingleton {
    static task: PipelineType = 'feature-extraction';
    static model = 'TaylorAI/bge-micro-v2';
    static instance: any = null;

    static async getInstance(progress_callback?: ProgressCallback) {
        if (!this.instance) {
            this.instance = await pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

// BoK data storage
let bokEmbeddings: number[][] | null = null;
let bokConceptIds: string[] | null = null;
let bokConceptNames: string[] | null = null;

// Cosine similarity function
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
}

// Calculate quantile (similar to np.quantile)
function quantile(arr: number[], q: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
}

// Mean pooling for embeddings
function meanPooling(embeddings: number[][]): number[] {
    const numTokens = embeddings.length;
    const embeddingSize = embeddings[0].length;
    const result = new Array(embeddingSize).fill(0);
    
    for (let i = 0; i < numTokens; i++) {
        for (let j = 0; j < embeddingSize; j++) {
            result[j] += embeddings[i][j];
        }
    }
    
    for (let j = 0; j < embeddingSize; j++) {
        result[j] /= numTokens;
    }
    
    return result;
}

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
    const { type, data } = event.data;

    try {
        switch (type) {
            case 'load-bok':
                // Load BoK embeddings data
                bokEmbeddings = data.embeddings;
                bokConceptIds = data.conceptIds;
                bokConceptNames = data.conceptNames;
                
                self.postMessage({
                    status: 'bok-loaded',
                    data: {
                        conceptCount: bokConceptIds?.length || 0
                    }
                });
                break;

            case 'classify':
                // Send initiate status
                self.postMessage({ status: 'initiate' });

                if (!bokEmbeddings || !bokConceptIds || !bokConceptNames) {
                    throw new Error('BoK embeddings not loaded. Please load BoK data first.');
                }

                // Get the feature extraction pipeline
                const extractor = await PipelineSingleton.getInstance((progress) => {
                    self.postMessage({
                        status: 'progress',
                        data: progress
                    });
                });

                // Send ready status once the model is loaded
                self.postMessage({ status: 'ready' });

                const textBlocks: string[] = data.textBlocks;
                const similarityThreshold: number = data.threshold || 0.8;
                const topPercentile: number = data.topPercentile || 0.95;

                // Map to track best match per concept (deduplication)
                const bestMatchPerConcept: Map<string, {
                    conceptId: string;
                    conceptName: string;
                    similarity: number;
                    matchingSentence: string;
                    pageNumber?: number;
                }> = new Map();
                
                const similarities: number[] = [];

                self.postMessage({
                    status: 'processing',
                    data: { total: textBlocks.length, current: 0 }
                });

                for (let i = 0; i < textBlocks.length; i++) {
                    const text = textBlocks[i];
                    
                    // Skip empty or very short text blocks
                    if (!text || text.trim().length < 10) {
                        self.postMessage({
                            status: 'processing',
                            data: { total: textBlocks.length, current: i + 1 }
                        });
                        continue;
                    }
                    
                    // Generate embedding for this text block
                    const output = await extractor(text, { pooling: 'mean', normalize: true });
                    const textEmbedding = Array.from(output.data as Float32Array);

                    // Calculate cosine similarity with all BoK concepts
                    for (let j = 0; j < bokEmbeddings.length; j++) {
                        const sim = cosineSimilarity(textEmbedding, bokEmbeddings[j]);
                        
                        if (sim >= similarityThreshold) {
                            const conceptId = bokConceptIds[j];
                            const existingMatch = bestMatchPerConcept.get(conceptId);
                            
                            // Only keep the match with highest similarity for each concept
                            if (!existingMatch || sim > existingMatch.similarity) {
                                // Extract a representative sentence from the text block
                                const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
                                const matchingSentence = sentences.length > 0 
                                    ? sentences[0].substring(0, 150) + (sentences[0].length > 150 ? '...' : '')
                                    : text.substring(0, 150) + (text.length > 150 ? '...' : '');
                                
                                bestMatchPerConcept.set(conceptId, {
                                    conceptId: conceptId,
                                    conceptName: bokConceptNames[j],
                                    similarity: sim,
                                    matchingSentence: matchingSentence,
                                    pageNumber: data.pageNumbers ? data.pageNumbers[i] : undefined
                                });
                            }
                            
                            similarities.push(sim);
                        }
                    }

                    // Report progress
                    self.postMessage({
                        status: 'processing',
                        data: { total: textBlocks.length, current: i + 1 }
                    });
                }

                // Convert map to array
                const allMatches = Array.from(bestMatchPerConcept.values());
                const uniqueIds = Array.from(bestMatchPerConcept.keys());

                // Apply configurable percentile threshold if we have matches
                let selectedIds: string[] = [];
                let selectedMatches: typeof allMatches = [];

                if (similarities.length > 0 && allMatches.length > 0) {
                    const thresholdValue = quantile(similarities, topPercentile);
                    
                    // Filter matches above the percentile threshold
                    selectedMatches = allMatches.filter(m => m.similarity >= thresholdValue);
                    selectedIds = selectedMatches.map(m => m.conceptId);

                    // Sort by similarity descending
                    selectedMatches.sort((a, b) => b.similarity - a.similarity);

                    // Add delay to allow progress bar to visually show 100% before completing
                    setTimeout(() => {
                        self.postMessage({
                            status: 'complete',
                            output: {
                                allMatchedIds: uniqueIds,
                                selectedIds: selectedIds,
                                matches: selectedMatches,
                                percentileThreshold: thresholdValue,
                                topPercentile: topPercentile,
                                totalMatches: allMatches.length,
                                selectedMatches: selectedMatches.length
                            }
                        });
                    }, 1500);
                } else {
                    // Add delay to allow progress bar to visually show 100% before completing
                    setTimeout(() => {
                        self.postMessage({
                            status: 'complete',
                            output: {
                                allMatchedIds: [],
                                selectedIds: [],
                                matches: [],
                                percentileThreshold: null,
                                topPercentile: topPercentile,
                                totalMatches: 0,
                                selectedMatches: 0
                            }
                        });
                    }, 1500);
                }
                break;

            default:
                self.postMessage({
                    status: 'error',
                    error: `Unknown message type: ${type}`
                });
        }
    } catch (error: unknown) {
        self.postMessage({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
