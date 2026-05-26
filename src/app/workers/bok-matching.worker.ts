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
const HYBRID_DENSE_WEIGHT = 0.75;
const HYBRID_BM25_WEIGHT = 0.25;

// BM25 configuration
const BM25_K1 = 1.5;
const BM25_B = 0.7;

// Jaro-Winkler fuzzy token matching
const JW_MIN_SIMILARITY = 0.94;
const JW_PREFIX_SCALE = 0.05;
const JW_MAX_PREFIX = 12;

// Score normalization & thresholding
const BM25_NORM_SCALE = 5.0;
const MIN_HYBRID_THRESHOLD = 0.5;

// State
let bokEmbeddings: number[][] | null = null;
let bokConceptIds: string[] | null = null;
let bokConceptNames: string[] | null = null;

// BM25 index state
let bm25DocTermFreqs: Array<Map<string, number>> = [];
let bm25DocLengths: number[] = [];
let bm25AvgDocLength = 0;
let bm25Idf = new Map<string, number>();
let bm25DocFreq = new Map<string, number>();
let bm25Terms: string[] = [];

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

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;

  const lenA = a.length;
  const lenB = b.length;
  if (!lenA || !lenB) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(lenA, lenB) / 2) - 1);
  const aMatches = new Array<boolean>(lenA).fill(false);
  const bMatches = new Array<boolean>(lenB).fill(false);

  let matches = 0;
  for (let i = 0; i < lenA; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, lenB);

    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (!matches) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < lenA; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const halfTranspositions = transpositions / 2;
  const jaro = (matches / lenA + matches / lenB + (matches - halfTranspositions) / matches) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(JW_MAX_PREFIX, lenA, lenB);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) {
    prefix++;
  }

  return jaro + prefix * JW_PREFIX_SCALE * (1 - jaro);
}

function buildBm25Index(conceptIds: string[], conceptNames: string[]): void {
  const docCount = conceptNames.length;
  bm25DocTermFreqs = new Array(docCount);
  bm25DocLengths = new Array(docCount);
  bm25Idf = new Map<string, number>();
  bm25DocFreq = new Map<string, number>();
  bm25Terms = [];

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

  bm25DocFreq = docFreq;
  bm25Terms = Array.from(docFreq.keys());

  for (const [term, df] of docFreq.entries()) {
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    bm25Idf.set(term, idf);
  }
}

function computeBm25Scores(queryTokens: string[]): Float32Array {
  const docCount = bm25DocTermFreqs.length;
  const scores = new Float32Array(docCount);
  if (!docCount || !bm25AvgDocLength || !queryTokens.length) {
    return scores;
  }

  const uniqueTerms = Array.from(new Set(queryTokens));
  const termMatches = new Map<string, Array<{ term: string; weight: number }>>();
  const termIdf = new Map<string, number>();

  for (const term of uniqueTerms) {
    const matches: Array<{ term: string; weight: number }> = [];
    for (const candidate of bm25Terms) {
      const similarity = jaroWinkler(term, candidate);
      if (similarity >= JW_MIN_SIMILARITY) {
        matches.push({ term: candidate, weight: similarity });
      }
    }

    if (!matches.length) continue;
    termMatches.set(term, matches);

    if (matches.length === 1 && matches[0].term === term) {
      const exactIdf = bm25Idf.get(term);
      if (exactIdf !== undefined) {
        termIdf.set(term, exactIdf);
        continue;
      }
    }

    let bestIdf = 0;
    for (const match of matches) {
      const matchIdf = bm25Idf.get(match.term) ?? 0;
      const effectiveIdf = matchIdf * match.weight;
      if (effectiveIdf > bestIdf) bestIdf = effectiveIdf;
    }
    termIdf.set(term, bestIdf);
  }

  for (let i = 0; i < docCount; i++) {
    const tfMap = bm25DocTermFreqs[i];
    const docLength = bm25DocLengths[i] ?? 0;
    if (!tfMap || !docLength) continue;

    let score = 0;
    for (const term of uniqueTerms) {
      const matches = termMatches.get(term);
      if (!matches) continue;

      let tf = 0;
      for (const match of matches) {
        const termTf = tfMap.get(match.term) ?? 0;
        if (termTf) tf += termTf * match.weight;
      }

      if (!tf) continue;
      const idf = termIdf.get(term) ?? 0;
      const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / bm25AvgDocLength));
      score += idf * ((tf * (BM25_K1 + 1)) / denom);
    }

    scores[i] = score;
  }

  return scores;
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
  const bestMatchPerConcept = new Map<string, BokMatch>();
  const allSimilarities: number[] = [];
  let lastReportedPercent = 0;

  postStatus('processing', { data: { total: textBlocks.length, current: 0 } });

  for (let i = 0; i < textBlocks.length; i++) {
    const text = textBlocks[i];
    if (!text || text.trim().length < 10) continue;

    const queryTokens = tokenize(text);
    const bm25Scores = computeBm25Scores(queryTokens);

    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const textEmbedding = Array.from(output.data as Float32Array);

    for (let j = 0; j < bokEmbeddings!.length; j++) {
      const denseSim = cosineSimilarity(textEmbedding, bokEmbeddings![j]);
      const bm25Raw = bm25Scores[j];
      const bm25Norm = bm25Raw > 0 ? 1 - Math.exp(-bm25Raw / BM25_NORM_SCALE) : 0;
      const hybridScore = (HYBRID_DENSE_WEIGHT * denseSim) + (HYBRID_BM25_WEIGHT * bm25Norm);

      if (hybridScore >= MIN_HYBRID_THRESHOLD) {
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
    console.error('[bok-matching.worker] Caught:', error);
    const errorMsg = error instanceof Error
      ? `${error.message}\n${error.stack ?? ''}`
      : typeof error === 'string'
        ? error
        : typeof error === 'number'
          ? `ONNX/WASM native error (pointer/code: ${error}). Likely invalid input encoding.`
          : JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}));
    postStatus('error', { error: errorMsg });
  }
});
