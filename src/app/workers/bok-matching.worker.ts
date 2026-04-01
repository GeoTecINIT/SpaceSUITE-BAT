import { pipeline, PipelineType , ProgressCallback /* @vite-ignore */} from "@huggingface/transformers";

// Types
interface BokMatch {
  conceptId: string;
  conceptName: string;
  similarity: number;
  matchingSentence: string;
  pageNumber?: number;
}

// State
let bokEmbeddings: number[][] | null = null;
let bokConceptIds: string[] | null = null;
let bokConceptNames: string[] | null = null;

// Pipeline singleton
class PipelineSingleton {
  static task: PipelineType = 'feature-extraction';
  static model = 'TaylorAI/bge-micro-v2';
  static instance: any = null;

  static async getInstance(progressCallback?: ProgressCallback) {
    this.instance ??= await pipeline(this.task, this.model, { progress_callback: progressCallback });
    return this.instance;
  }
}

// Utility functions
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0, normA = 0, normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  return (normA === 0 || normB === 0) ? 0 : dotProduct / (normA * normB);
}

function extractSentence(text: string, maxLength = 150): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 100);
  const source = sentences.length > 0 ? sentences[0] : text;
  return source.length > maxLength ? source.substring(0, maxLength) + '...' : source;
}

function postStatus(status: string, data?: any): void {
  self.postMessage({ status, ...data });
}

// Message handlers
function handleLoadBok(data: any): void {
  bokEmbeddings = data.embeddings;
  bokConceptIds = data.conceptIds;
  bokConceptNames = data.conceptNames;
  
  postStatus('bok-loaded', { data: { conceptCount: bokConceptIds?.length || 0 } });
}

async function handleClassify(data: any): Promise<void> {
  postStatus('initiate');

  if (!bokEmbeddings || !bokConceptIds || !bokConceptNames) {
    throw new Error('BoK embeddings not loaded. Please load BoK data first.');
  }

  const extractor = await PipelineSingleton.getInstance((progress) => {
    postStatus('progress', { data: progress });
  });

  postStatus('ready');

  const { textBlocks, pageNumbers } = data;
  const minThreshold = 0.5;
  const bestMatchPerConcept = new Map<string, BokMatch>();
  const allSimilarities: number[] = [];
  let lastReportedPercent = 0;

  postStatus('processing', { data: { total: textBlocks.length, current: 0 } });

  for (let i = 0; i < textBlocks.length; i++) {
    const text = textBlocks[i];
    if (!text || text.trim().length < 10) continue;
    
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const textEmbedding = Array.from(output.data as Float32Array);

    for (let j = 0; j < bokEmbeddings!.length; j++) {
      const sim = cosineSimilarity(textEmbedding, bokEmbeddings![j]);
      
      if (sim >= minThreshold) {
        const conceptId = bokConceptIds![j];
        const existingMatch = bestMatchPerConcept.get(conceptId);
        
        if (!existingMatch || sim > existingMatch.similarity) {
          bestMatchPerConcept.set(conceptId, {
            conceptId,
            conceptName: bokConceptNames![j],
            similarity: sim,
            matchingSentence: extractSentence(text),
            pageNumber: pageNumbers?.[i]
          });
        }
        
        allSimilarities.push(sim);
      }
    }

    const currentPercent = Math.floor(((i + 1) / textBlocks.length) * 100);
    const currentPercentRounded = Math.floor(currentPercent / 5) * 5;
    
    if (currentPercentRounded > lastReportedPercent || i === textBlocks.length - 1) {
      lastReportedPercent = currentPercentRounded;
      postStatus('processing', { data: { total: textBlocks.length, current: i + 1 } });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const allMatches = Array.from(bestMatchPerConcept.values()).sort((a, b) => b.similarity - a.similarity);

  setTimeout(() => {
    postStatus('complete', { output: { allMatches, allSimilarities } });
  }, 1500);
}

// Event listener
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;

  try {
    switch (type) {
      case 'load-bok':
        handleLoadBok(data);
        break;
      case 'classify':
        await handleClassify(data);
        break;
      default:
        postStatus('error', { error: `Unknown message type: ${type}` });
    }
  } catch (error: unknown) {
    postStatus('error', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
