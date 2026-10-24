// SQLite database: every generation (CV + cover letter), in data/cv.db
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_FILE } from './config';
import type { Content } from './types';

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,            -- ISO date
    updated_at  TEXT,                     -- last edit on the page
    engine      TEXT,
    tailoring   TEXT,                     -- aggressive | strict
    company     TEXT,
    job_title   TEXT,
    headline    TEXT,
    ats_report  TEXT,
    job_offer   TEXT,
    resume_json TEXT,                     -- the content behind the PDFs, editable on the page
    letter_json TEXT,
    resume_pdf  BLOB,
    letter_pdf  BLOB
  );
  -- same date + engine = same generation (makes browser imports safe to repeat)
  CREATE UNIQUE INDEX IF NOT EXISTS generations_unique ON generations (created_at, engine);
`);

/** One row as the page gets it (PDFs in base64) */
export interface Generation {
  id: number;
  createdAt: string;
  updatedAt: string | null;
  engine: string;
  tailoring: string | null;
  company: string;
  jobTitle: string;
  headline: string;
  atsReport: string;
  jobOffer: string | null;
  resume: Content | null;
  letter: Content | null;
  resumePdf: string;
  letterPdf: string;
}

/** One line of the history table (no PDFs) */
export interface Summary {
  id: number;
  createdAt: string;
  engine: string;
  tailoring: string | null;
  company: string;
  jobTitle: string;
  ats: string;          // "18/18"
}

export interface NewGeneration {
  createdAt?: string;
  engine: string;
  tailoring?: string | null;
  company?: string;
  jobTitle?: string;
  headline?: string;
  atsReport?: string;
  jobOffer?: string | null;
  resume?: Content | null;
  letter?: Content | null;
  resumePdf: string;    // base64
  letterPdf: string;    // base64
}

const b64 = (bytes: unknown) => (bytes ? Buffer.from(bytes as Uint8Array).toString('base64') : '');
const json = (text: unknown) => (typeof text === 'string' && text ? JSON.parse(text) : null);
const atsCovered = (report: unknown) => String(report || '').match(/(\d+\s*\/\s*\d+)/)?.[1].replace(/\s/g, '') || '';

const insert = db.prepare(`
  INSERT OR IGNORE INTO generations
    (created_at, engine, tailoring, company, job_title, headline, ats_report, job_offer, resume_json, letter_json, resume_pdf, letter_pdf)
  VALUES ($createdAt, $engine, $tailoring, $company, $jobTitle, $headline, $atsReport, $jobOffer, $resume, $letter, $resumePdf, $letterPdf)
`);

/** Save a generation; returns its id, or null if it was already there (same date + engine) */
export function saveGeneration(g: NewGeneration): number | null {
  const res = insert.run({
    $createdAt: g.createdAt || new Date().toISOString(),
    $engine: g.engine,
    $tailoring: g.tailoring ?? null,
    $company: g.company ?? '',
    $jobTitle: g.jobTitle ?? '',
    $headline: g.headline ?? '',
    $atsReport: g.atsReport ?? '',
    $jobOffer: g.jobOffer ?? null,
    $resume: g.resume ? JSON.stringify(g.resume) : null,
    $letter: g.letter ? JSON.stringify(g.letter) : null,
    $resumePdf: Buffer.from(g.resumePdf || '', 'base64'),
    $letterPdf: Buffer.from(g.letterPdf || '', 'base64')
  });
  return res.changes ? Number(res.lastInsertRowid) : null;
}

/** After an edit on the page: new content + new PDF for the CV or the letter */
export function updateDocument(id: number, kind: 'resume' | 'letter', content: Content, pdf: string) {
  const now = new Date().toISOString();
  const bytes = Buffer.from(pdf, 'base64');
  if (kind === 'resume') {
    db.prepare(`UPDATE generations SET resume_json = ?, resume_pdf = ?, headline = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(content), bytes, content.HEADLINE ?? '', now, id);
  } else {
    db.prepare(`UPDATE generations SET letter_json = ?, letter_pdf = ?, company = ?, job_title = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(content), bytes, content.COMPANY_NAME ?? '', content.JOB_TITLE ?? '', now, id);
  }
}

/** History, newest first (no PDFs: fast) */
export function listGenerations(limit = 1000): Summary[] {
  return db.prepare(`
    SELECT id, created_at, engine, tailoring, company, job_title, ats_report
    FROM generations ORDER BY created_at DESC LIMIT ?
  `).all(limit).map((r: any) => ({
    id: r.id, createdAt: r.created_at, engine: r.engine, tailoring: r.tailoring,
    company: r.company, jobTitle: r.job_title, ats: atsCovered(r.ats_report)
  }));
}

export function getGeneration(id: number): Generation | null {
  const r: any = db.prepare(`SELECT * FROM generations WHERE id = ?`).get(id);
  if (!r) return null;
  return {
    id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, engine: r.engine, tailoring: r.tailoring,
    company: r.company, jobTitle: r.job_title, headline: r.headline, atsReport: r.ats_report, jobOffer: r.job_offer,
    resume: json(r.resume_json), letter: json(r.letter_json),
    resumePdf: b64(r.resume_pdf), letterPdf: b64(r.letter_pdf)
  };
}

/** One PDF as raw bytes, for downloads */
export function getPdf(id: number, kind: 'resume' | 'letter'): { bytes: Buffer; company: string } | null {
  const r: any = db.prepare(`SELECT ${kind === 'resume' ? 'resume_pdf' : 'letter_pdf'} AS pdf, company FROM generations WHERE id = ?`).get(id);
  return r?.pdf ? { bytes: Buffer.from(r.pdf), company: r.company || 'offer' } : null;
}

export function deleteGeneration(id: number): boolean {
  return db.prepare(`DELETE FROM generations WHERE id = ?`).run(id).changes > 0;
}

/** The whole history as CSV (opens in Excel / LibreOffice / Google Sheets) */
export function historyCsv(): string {
  const rows: any[] = db.prepare(`
    SELECT id, created_at, company, job_title, engine, tailoring, ats_report, headline, job_offer
    FROM generations ORDER BY created_at DESC
  `).all();
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'date', 'company', 'job_title', 'engine', 'mode', 'ats_covered', 'headline', 'job_offer', 'cv_pdf', 'letter_pdf'];
  const lines = rows.map(r => [
    r.id, r.created_at, r.company, r.job_title, r.engine, r.tailoring, atsCovered(r.ats_report), r.headline, r.job_offer,
    `http://localhost:8080/api/generations/${r.id}/cv.pdf`, `http://localhost:8080/api/generations/${r.id}/letter.pdf`
  ].map(cell).join(','));
  return '﻿' + [header.join(','), ...lines].join('\r\n');   // BOM: accents display right in Excel
}
