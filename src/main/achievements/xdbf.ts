import { Reader, fourcc } from './binary';
import { tt } from '@shared/i18n';

export const XLanguage = { English: 1, Japanese: 2, German: 3, French: 4, Spanish: 5, Italian: 6, Korean: 7, TChinese: 8, Portuguese: 9, SChinese: 10, Polish: 11, Russian: 12 } as const;

const SECTION_METADATA = 1, SECTION_IMAGE = 2, SECTION_STRINGS = 3;
const ID_XACH = BigInt(fourcc('XACH')), ID_XSTC = BigInt(fourcc('XSTC')), ID_TITLE = 0x8000n;

export interface XdbfAchievement {
  id: number; labelId: number; descriptionId: number; unachievedId: number;
  imageId: number; gamerscore: number; flags: number;
}
export interface XdbfAchievementText { id: number; name: string; description: string; lockedDescription: string; gamerscore: number; imageId: number }

interface Entry { section: number; id: bigint; offset: number; size: number }

export class Xdbf {
  private entries: Entry[] = [];
  private contentStart = 0;

  constructor(private data: Uint8Array) {
    const r = new Reader(data);
    if (r.u32() !== fourcc('XDBF')) throw new Error(tt('não é um XDBF'));
    r.u32();
    const entryCount = r.u32(), entryUsed = r.u32(), freeCount = r.u32(); r.u32();
    for (let i = 0; i < entryCount; i++) {
      const e = { section: r.u16(), id: r.u64(), offset: r.u32(), size: r.u32() };
      if (i < entryUsed) this.entries.push(e);
    }
    r.skip(freeCount * 8);
    this.contentStart = r.pos;
  }

  block(section: number, id: bigint): Uint8Array | null {
    const e = this.entries.find(x => x.section === section && x.id === id);
    if (!e) return null;
    const start = this.contentStart + e.offset;
    if (start + e.size > this.data.byteLength) return null;
    return this.data.subarray(start, start + e.size);
  }

  defaultLanguage(): number {
    const b = this.block(SECTION_METADATA, ID_XSTC);
    if (!b) return XLanguage.English;
    const r = new Reader(b);
    if (r.u32() !== fourcc('XSTC')) return XLanguage.English;
    r.u32(); r.u32();
    return r.u32();
  }

  hasLanguage(lang: number) { return !!this.block(SECTION_STRINGS, BigInt(lang)); }

  strings(lang: number): Map<number, string> {
    const out = new Map<number, string>();
    const b = this.block(SECTION_STRINGS, BigInt(lang));
    if (!b) return out;
    const r = new Reader(b);
    if (r.u32() !== fourcc('XSTR')) return out;
    r.u32(); r.u32();
    const count = r.u16();
    for (let i = 0; i < count; i++) { const id = r.u16(), len = r.u16(); out.set(id, r.utf8(len)); }
    return out;
  }

  achievements(): XdbfAchievement[] {
    const b = this.block(SECTION_METADATA, ID_XACH);
    if (!b) return [];
    const r = new Reader(b);
    if (r.u32() !== fourcc('XACH')) return [];
    r.u32(); r.u32();
    const count = r.u16(), out: XdbfAchievement[] = [];
    for (let i = 0; i < count; i++) {
      const id = r.u16(), labelId = r.u16(), descriptionId = r.u16(), unachievedId = r.u16(), imageId = r.u32(), gamerscore = r.u16();
      r.u16(); const flags = r.u32(); r.skip(16);
      out.push({ id, labelId, descriptionId, unachievedId, imageId, gamerscore, flags });
    }
    return out;
  }

  image(id: number): Uint8Array | null { return this.block(SECTION_IMAGE, BigInt(id)); }
  titleIcon() { return this.block(SECTION_IMAGE, ID_TITLE); }

  achievementTexts(prefer: number[] = [XLanguage.Portuguese, XLanguage.English]): XdbfAchievementText[] {
    const lang = [...prefer, this.defaultLanguage()].find(l => this.hasLanguage(l)) ?? this.defaultLanguage();
    const s = this.strings(lang);
    return this.achievements().map(a => ({
      id: a.id, gamerscore: a.gamerscore, imageId: a.imageId,
      name: fixText(s.get(a.labelId) ?? tt('Conquista {0}', { 0: a.id })),
      description: fixText(s.get(a.descriptionId) ?? ''),
      lockedDescription: fixText(s.get(a.unachievedId) ?? ''),
    }));
  }
}

const fixText = (t: string) => t.replace(/’/g, "'").replace(/\0+$/, '');
