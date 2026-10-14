// prompts/profile.md: a contact block between --- lines at the top, then your profile in plain text.
// The contact details are added to the CV and the letter by the app; the AI only sees the profile text.
import fs from 'node:fs';
import { PROFILE_FILE } from './config';
import type { Contact } from './types';

const CONTACT_KEYS: (keyof Contact)[] = ['name', 'email', 'phone', 'location', 'github', 'linkedin'];

export function readProfile(): { contact: Contact; text: string } {
  if (!fs.existsSync(PROFILE_FILE)) {
    throw new Error('prompts/profile.md is missing: cp prompts/profile.example.md prompts/profile.md, then fill it in.');
  }
  const raw = fs.readFileSync(PROFILE_FILE, 'utf8').replace(/\r\n/g, '\n');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const contact: Contact = {};
  for (const line of (match?.[1] || '').split('\n')) {
    const m = line.match(/^\s*([a-z]+)\s*:\s*(.+?)\s*$/i);          // "key: value", # lines are comments
    const key = m?.[1].toLowerCase() as keyof Contact;
    if (m && CONTACT_KEYS.includes(key)) contact[key] = m[2];
  }
  const text = raw.slice(match ? match[0].length : 0).trim();
  if (!text) throw new Error('prompts/profile.md is empty: write your profile below the contact block.');
  if (!contact.name) throw new Error('prompts/profile.md: add "name: …" in the contact block at the top.');
  return { contact, text };
}
