import { pipeline, PipelineType, ProgressCallback /* @vite-ignore */} from "@huggingface/transformers";

// Use the Singleton pattern to enable lazy construction of the pipeline.
class PipelineSingleton {
    static task: PipelineType = 'feature-extraction';
    static model = 'TaylorAI/bge-micro-v2';
    // Alternatives:
    // TaylorAI/bge-micro-v2: 384-dim, smaller model, faster but less accurate (20ms/block))
    // onnx-community/embeddinggemma-300m-ONNX: 1024-dim, larger model, more accurate but slower (1s/block!)

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
                // Use a low minimum threshold to capture all potential matches for dynamic filtering
                const minThreshold = 0.5;

                // Map to track best match per concept (deduplication)
                const bestMatchPerConcept: Map<string, {
                    conceptId: string;
                    conceptName: string;
                    similarity: number;
                    matchingSentence: string;
                    pageNumber?: number;
                }> = new Map();
                
                const allSimilarities: number[] = [];

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
                        
                        // Use low minimum threshold to capture all potential matches
                        if (sim >= minThreshold) {
                            const conceptId = bokConceptIds[j];
                            const existingMatch = bestMatchPerConcept.get(conceptId);
                            
                            // Only keep the match with highest similarity for each concept
                            if (!existingMatch || sim > existingMatch.similarity) {
                                // Extract a representative sentence from the text block
                                const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 100);
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
                            
                            allSimilarities.push(sim);
                        }
                    }

                    // Report progress
                    self.postMessage({
                        status: 'processing',
                        data: { total: textBlocks.length, current: i + 1 }
                    });
                }

                // Convert map to array - return ALL raw matches for client-side filtering
                const allMatches = Array.from(bestMatchPerConcept.values());
                
                // Sort by similarity descending
                allMatches.sort((a, b) => b.similarity - a.similarity);

                // Add delay to allow progress bar to visually show 100% before completing
                setTimeout(() => {
                    self.postMessage({
                        status: 'complete',
                        output: {
                            // Return all raw matches and similarities for client-side dynamic filtering
                            allMatches: allMatches,
                            allSimilarities: allSimilarities
                        }
                    });
                }, 1500);
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
