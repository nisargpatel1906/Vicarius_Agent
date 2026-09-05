import { GoogleGenerativeAI } from '@google/generative-ai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getSupabaseAdmin } from './supabase';
import * as dotenv from 'dotenv';
dotenv.config();

function getGenAI(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY || '';
  return new GoogleGenerativeAI(key);
}

/**
 * Generate a 768-dimensional embedding for a given text using Google's gemini-embedding-001.
 * Safely caps input length to prevent token overflow on large documents.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const safeText = (text || '').trim().slice(0, 9000);
    if (!safeText) {
      return new Array(768).fill(0);
    }
    const genAI = getGenAI();
    const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
    const result = await embeddingModel.embedContent({
      content: { parts: [{ text: safeText }] },
      outputDimensionality: 768,
    } as any);
    return result.embedding.values;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Split text into overlapping semantic chunks of ~500 characters.
 */
export async function chunkText(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });
  
  const documents = await splitter.createDocuments([text]);
  return documents.map(doc => doc.pageContent);
}

/**
 * Extract raw text from a PDF Buffer.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    if (typeof (globalThis as any).DOMMatrix === 'undefined') {
      (globalThis as any).DOMMatrix = class DOMMatrix {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
        m11 = 1; m12 = 0; m13 = 0; m14 = 0;
        m21 = 0; m22 = 1; m23 = 0; m24 = 0;
        m31 = 0; m32 = 0; m33 = 1; m34 = 0;
        m41 = 0; m42 = 0; m43 = 0; m44 = 1;
        is2D = true;
        isIdentity = true;
      };
    }
    if (typeof (globalThis as any).ImageData === 'undefined') {
      (globalThis as any).ImageData = class ImageData {
        width = 0; height = 0; data = new Uint8ClampedArray(0);
      };
    }
    if (typeof (globalThis as any).Path2D === 'undefined') {
      (globalThis as any).Path2D = class Path2D {};
    }

    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const res = await parser.getText();
    await parser.destroy();
    return res.text || '';
  } catch (error) {
    console.error('Error extracting PDF text:', error);
    return '';
  }
}

/**
 * Extract raw text and tables from a Word (.docx) Buffer.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (error) {
    console.error('Error extracting DOCX text:', error);
    return '';
  }
}

/**
 * Extract visual and text content from an image buffer using Gemini Vision.
 */
export async function extractImageText(buffer: Buffer, mimeType: string = 'image/jpeg'): Promise<string> {
  try {
    const visionModelName = process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash-lite';
    const genAI = getGenAI();
    const visionModel = genAI.getGenerativeModel({ model: visionModelName });
    const prompt = `You are an academic transcription assistant. Transcribe and extract all text, questions, assignment instructions, mathematical formulas, tables, diagrams, and handwritten notes from this image verbatim as clean, structured markdown. Do not summarize or solve them. If no text or diagrams are present, output "NO_EXTRACTABLE_CONTENT".`;

    const base64Data = buffer.toString('base64');
    const result = await visionModel.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType || 'image/jpeg',
        },
      },
    ]);

    const text = result.response.text();
    if (text.includes('NO_EXTRACTABLE_CONTENT')) {
      return '';
    }
    return text.trim();
  } catch (error) {
    console.error('Error extracting image text with Gemini Vision:', error);
    return '';
  }
}

/**
 * Query the Knowledge Base using vector similarity search.
 */
export async function queryKnowledgeBase(queryText: string, filterCourse: string | null = null, limit: number = 5): Promise<any[]> {
  try {
    const queryEmbedding = await generateEmbedding(queryText);
    const supabase = getSupabaseAdmin();
    
    const { data, error } = await supabase.rpc('match_knowledge', {
      query_embedding: queryEmbedding,
      match_threshold: 0.65,
      match_count: limit,
      filter_course: filterCourse
    });

    if (error) {
      console.error('RPC Error in match_knowledge:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Error querying knowledge base:', err);
    return [];
  }
}

