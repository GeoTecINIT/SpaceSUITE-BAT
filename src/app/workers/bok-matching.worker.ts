import { pipeline, PipelineType , ProgressCallback /* @vite-ignore */} from "@huggingface/transformers";

// Types
interface BokMatch {
  conceptId: string;
  conceptName: string;
  similarity: number;
  matchingSentence: string;
  pageNumber?: number;
}

// Hybrid weighting
const HYBRID_DENSE_WEIGHT = 0.7;
const HYBRID_BM25_WEIGHT = 0.3;

// BM25 configuration
const BM25_K1 = 1.5;
const BM25_B = 0.75;

// State
let bokEmbeddings: number[][] | null = null;
let bokConceptIds: string[] | null = null;
let bokConceptNames: string[] | null = null;

// BM25 index state
let bm25DocTermFreqs: Array<Map<string, number>> = [];
let bm25DocLengths: number[] = [];
let bm25AvgDocLength = 0;
let bm25Idf = new Map<string, number>();

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

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized ? normalized.split(/\s+/).filter(t => t.length > 1) : [];
}

function buildBm25Index(conceptIds: string[], conceptNames: string[]): void {
  const docCount = conceptNames.length;
  bm25DocTermFreqs = new Array(docCount);
  bm25DocLengths = new Array(docCount);
  bm25Idf = new Map<string, number>();

  const docFreq = new Map<string, number>();
  let totalLength = 0;

  for (let i = 0; i < docCount; i++) {
    const id = conceptIds[i] ?? '';
    const name = conceptNames[i] ?? '';
    const tokens = tokenize(`${id} ${name}`);

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    bm25DocTermFreqs[i] = tf;
    bm25DocLengths[i] = tokens.length;
    totalLength += tokens.length;

    const unique = new Set(tokens);
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  bm25AvgDocLength = docCount ? totalLength / docCount : 0;

  for (const [term, df] of docFreq.entries()) {
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    bm25Idf.set(term, idf);
  }
}

function computeBm25Scores(queryTokens: string[]): { scores: Float32Array; max: number } {
  const docCount = bm25DocTermFreqs.length;
  const scores = new Float32Array(docCount);
  if (!docCount || !bm25AvgDocLength || !queryTokens.length) {
    return { scores, max: 0 };
  }

  const uniqueTerms = Array.from(new Set(queryTokens));
  let max = 0;

  for (let i = 0; i < docCount; i++) {
    const tfMap = bm25DocTermFreqs[i];
    const docLength = bm25DocLengths[i] ?? 0;
    if (!tfMap || !docLength) continue;

    let score = 0;
    for (const term of uniqueTerms) {
      const tf = tfMap.get(term) ?? 0;
      if (!tf) continue;
      const idf = bm25Idf.get(term) ?? 0;
      const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / bm25AvgDocLength));
      score += idf * ((tf * (BM25_K1 + 1)) / denom);
    }

    scores[i] = score;
    if (score > max) max = score;
  }

  return { scores, max };
}

function postStatus(status: string, data?: any): void {
  self.postMessage({ status, ...data });
}

// Message handlers
function handleLoadBok(data: any): void {
  bokEmbeddings = data.embeddings;
  bokConceptIds = data.conceptIds;
  bokConceptNames = data.conceptNames;

  if (bokConceptIds && bokConceptNames) {
    buildBm25Index(bokConceptIds, bokConceptNames);
  }
  
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

    const queryTokens = tokenize(text);
    const { scores: bm25Scores, max: maxBm25 } = computeBm25Scores(queryTokens);
    const bm25NormFactor = maxBm25 > 0 ? 1 / maxBm25 : 0;
    
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const textEmbedding = Array.from(output.data as Float32Array);

    for (let j = 0; j < bokEmbeddings!.length; j++) {
      const denseSim = cosineSimilarity(textEmbedding, bokEmbeddings![j]);
      const bm25Norm = bm25Scores[j] * bm25NormFactor;
      const hybridScore = (HYBRID_DENSE_WEIGHT * denseSim) + (HYBRID_BM25_WEIGHT * bm25Norm);
      
      if (hybridScore >= minThreshold) {
        const conceptId = bokConceptIds![j];
        const existingMatch = bestMatchPerConcept.get(conceptId);
        
        if (!existingMatch || hybridScore > existingMatch.similarity) {
          bestMatchPerConcept.set(conceptId, {
            conceptId,
            conceptName: bokConceptNames![j],
            similarity: hybridScore,
            matchingSentence: extractSentence(text),
            pageNumber: pageNumbers?.[i]
          });
        }
        
        allSimilarities.push(hybridScore);
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
