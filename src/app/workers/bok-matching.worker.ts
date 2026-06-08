import { pipeline, PipelineType , ProgressCallback /* @vite-ignore */} from "@huggingface/transformers";

// Types
interface BokMatch {
  conceptId: string;
  conceptName: string;
  similarity: number;
  matchingSentence: string;
  pageNumber?: number;
}

type WorkerStatus = 'initiate' | 'progress' | 'ready' | 'processing' | 'complete' | 'error' | 'bok-loaded';

interface LoadBokPayload {
  embeddings: number[][];
  conceptIds: string[];
  conceptNames: string[];
}

interface ClassifyPayload {
  textBlocks: string[];
  pageNumbers?: number[];
}

// Hybrid weighting
const HYBRID_DENSE_WEIGHT = 0.75; // Embedding similarity weight
const HYBRID_LEXICAL_WEIGHT = 0.25; // Lexical score weight

// Lexical title score
const PERFECT_MATCH_WEIGHT = 0.3; //Bonus
const LENGTH_SATURATION = 2; // Saturation point for the title-length factor (see computeLexicalScores).

// Jaro-Winkler fuzzy token matching
const JW_MIN_SIMILARITY = 0.94; // High threshold to avoid false positives (Fuzzy matching)
const JW_PREFIX_SCALE = 0.05; // Small boost for common prefixes, up to JW_MAX_PREFIX characters
const JW_MAX_PREFIX = 12; // Number of initial characters to consider for the prefix boost

// State
let bokEmbeddings: number[][] | null = null;
let bokConceptIds: string[] | null = null;
let bokConceptNames: string[] | null = null;

// Lexical index state
let lexConceptTokens: string[][] = [];
let lexConceptIdfSum: number[] = [];
let lexVocab = new Set<string>();
let lexIdf = new Map<string, number>();
let lexMaxIdf = 0;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'by', 'from', 'at', 'as', 'is', 'are', 'be', 'this', 'that', 'into',
  'using', 'use', 'based', 'via'
]);

// Pipeline singleton
class PipelineSingleton {
  static task: PipelineType = 'feature-extraction';
  static model = 'TaylorAI/bge-micro-v2';
  static instance: any = null;

  static async getInstance(progressCallback?: ProgressCallback) {
    // dtype 'q8' (8-bit) or full precision 'fp' (32-bit) can be set when loading the model. 8-bit is much faster and uses less memory, with minimal impact on similarity ranking.
    this.instance ??= await pipeline(this.task, this.model, { progress_callback: progressCallback, dtype: 'q8' });
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
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 80);
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

function titleTokens(name: string): string[] {
  return Array.from(new Set(tokenize(name).filter(t => !STOPWORDS.has(t))));
}

function buildLexicalIndex(conceptNames: string[]): void {
  const docCount = conceptNames.length;
  lexConceptTokens = new Array(docCount);
  lexConceptIdfSum = new Array(docCount);
  lexVocab = new Set<string>();
  lexIdf = new Map<string, number>();
  lexMaxIdf = 0;

  const docFreq = new Map<string, number>();

  for (let i = 0; i < docCount; i++) {
    const tokens = titleTokens(conceptNames[i] ?? '');
    lexConceptTokens[i] = tokens;
    for (const token of tokens) {
      lexVocab.add(token);
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  for (const [term, df] of docFreq.entries()) {
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    lexIdf.set(term, idf);
    if (idf > lexMaxIdf) lexMaxIdf = idf;
  }

  for (let i = 0; i < docCount; i++) {
    lexConceptIdfSum[i] = lexConceptTokens[i].reduce((sum, t) => sum + (lexIdf.get(t) ?? 0), 0);
  }
}

// Lexical score per concept: lengthFactor × (IDF-weighted coverage + full-match bonus).
function computeLexicalScores(queryTokens: string[]): Float32Array {
  const docCount = lexConceptTokens.length;
  const scores = new Float32Array(docCount);
  if (!docCount || !queryTokens.length || !lexVocab.size || !lexMaxIdf) {
    return scores;
  }

  // Drop stopwords for coverage (doesn't add value).
  const uniqueQuery = Array.from(new Set(queryTokens)).filter(t => !STOPWORDS.has(t));

  // Title-vocabulary tokens present in the text.
  const present = new Set<string>();
  for (const q of uniqueQuery) {
    if (lexVocab.has(q)) present.add(q);
  }
  for (const term of lexVocab) {
    if (present.has(term)) continue;
    for (const q of uniqueQuery) {
      if (jaroWinkler(q, term) >= JW_MIN_SIMILARITY) {
        present.add(term);
        break;
      }
    }
  }

  for (let i = 0; i < docCount; i++) {
    const tokens = lexConceptTokens[i];
    const total = tokens.length;
    if (!total) continue;

    let matched = 0;
    let matchedIdf = 0;
    for (const token of tokens) {
      if (!present.has(token)) continue;
      matched++;
      matchedIdf += lexIdf.get(token) ?? 0;
    }
    if (!matched) continue;

    // IDF-weighted coverage penalizes matching only common terms.
    const coverage = matchedIdf / lexConceptIdfSum[i];
    const perfect = matched === total ? 1 : 0;
    // Length factor devalues short titles: a 1-word match is weaker than 2-of-3.
    const lengthFactor = Math.min(total, LENGTH_SATURATION) / LENGTH_SATURATION;
    scores[i] = lengthFactor * (coverage + PERFECT_MATCH_WEIGHT * perfect);
  }

  return scores;
}

function postStatus(status: WorkerStatus, data?: Record<string, unknown>): void {
  self.postMessage({ status, ...data });
}

// Message handlers
function handleLoadBok(data: LoadBokPayload): void {
  bokEmbeddings = data.embeddings;
  bokConceptIds = data.conceptIds;
  bokConceptNames = data.conceptNames;

  if (bokConceptNames) {
    buildLexicalIndex(bokConceptNames);
  }

  postStatus('bok-loaded', { data: { conceptCount: bokConceptIds?.length || 0 } });
}

async function handleClassify(data: ClassifyPayload): Promise<void> {
  postStatus('initiate');

  if (!bokEmbeddings || !bokConceptIds || !bokConceptNames) {
    throw new Error('BoK embeddings not loaded. Please load BoK data first.');
  }
  const embeddings = bokEmbeddings;
  const conceptIds = bokConceptIds;
  const conceptNames = bokConceptNames;

  const extractor = await PipelineSingleton.getInstance((progress) => {
    postStatus('progress', { data: progress });
  });

  postStatus('ready');

  const { textBlocks, pageNumbers } = data;
  const bestMatchPerConcept = new Map<string, BokMatch>();
  let lastReportedPercent = 0;

  postStatus('processing', { data: { total: textBlocks.length, current: 0 } });

  for (let i = 0; i < textBlocks.length; i++) {
    const text = textBlocks[i];
    if (!text || text.trim().length < 10) continue;

    const queryTokens = tokenize(text);
    const lexScores = computeLexicalScores(queryTokens);

    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const textEmbedding = Array.from(output.data as Float32Array);

    for (let j = 0; j < embeddings.length; j++) {
      const denseSim = cosineSimilarity(textEmbedding, embeddings[j]);
      const lexScore = lexScores[j];
      const hybridScore = Math.min(1, (HYBRID_DENSE_WEIGHT * denseSim) + (HYBRID_LEXICAL_WEIGHT * lexScore));

      const conceptId = conceptIds[j];
      const existingMatch = bestMatchPerConcept.get(conceptId);

      if (!existingMatch || hybridScore > existingMatch.similarity) {
        bestMatchPerConcept.set(conceptId, {
          conceptId,
          conceptName: conceptNames[j],
          similarity: hybridScore,
          matchingSentence: extractSentence(text),
          pageNumber: pageNumbers?.[i]
        });
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
    postStatus('complete', { output: { allMatches } });
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
  } catch {
    postStatus('error', { error: 'An error occurred during processing.' });
  }
});
