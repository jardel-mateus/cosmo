import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Glyph, useKeys } from '../lib/input';
import { sfx } from '../lib/sfx';
import { useTRPC } from '../trpc';
import { tt } from '@shared/i18n';

type Layer = 'abc' | 'sym' | 'acc';
const LAYERS: Record<Layer, string[]> = {
  abc: ['1234567890', 'qwertyuiop', 'asdfghjklç', 'zxcvbnm,.-'],
  sym: ['1234567890', '!@#$%&*()_', '\\/:;\'"?+=~', '[]{}<>|^`´'],
  acc: ['áàâãäéèêë', 'íìîóòôõöú', 'ùûüçñªº°¨'],
};
const SHIFT_NUM: Record<string, string> = { 1: '!', 2: '@', 3: '#', 4: '$', 5: '%', 6: '¨', 7: '&', 8: '*', 9: '(', 0: ')', ',': ';', '.': ':', '-': '_' };
const SPECIAL = [['shift', '⇧'], ['caps', 'CAPS'], ['layer', '?123'], ['acc', 'ÁÉ'], ['space', tt('ESPAÇO')], ['left', '←'], ['right', '→'], ['del', '⌫'], ['clear', tt('LIMPAR')], ['paste', tt('COLAR')], ['ok', 'OK']] as const;
type Special = typeof SPECIAL[number][0];

export function Osk({ value, onChange, onDone, onCancel, label }: { value: string; onChange: (v: string) => void; onDone: () => void; onCancel: () => void; label: string }) {
  const [layer, setLayer] = useState<Layer>('abc');
  const [shift, setShift] = useState(false), [caps, setCaps] = useState(false);
  const [r, setR] = useState(1), [c, setC] = useState(0);
  const [pos, setPos] = useState(value.length);
  const mine = useRef(value);
  useEffect(() => { if (value !== mine.current) { mine.current = value; setPos(value.length); } }, [value]);
  const trpc = useTRPC();
  const clip = useMutation(trpc.system.clipboard.mutationOptions());

  const rows = LAYERS[layer];
  const nRows = rows.length + 1;
  const width = (ri: number) => (ri < rows.length ? rows[ri]!.length : SPECIAL.length);
  const upper = shift !== caps;
  const show = (ch: string) => (layer !== 'abc' ? (upper ? ch.toUpperCase() : ch) : upper ? SHIFT_NUM[ch] ?? ch.toUpperCase() : ch);
  const at = Math.min(pos, value.length);
  const put = (v: string, p: number) => { mine.current = v; onChange(v); setPos(p); };
  const insert = (t: string) => { put(value.slice(0, at) + t + value.slice(at), at + t.length); if (shift) setShift(false); };
  const del = () => { if (at > 0) put(value.slice(0, at - 1) + value.slice(at), at - 1); };
  const move = (d: number) => setPos(Math.max(0, Math.min(value.length, at + d)));

  const special = (k: Special) => {
    if (k === 'ok') { sfx.play('ok'); onDone(); return; }
    sfx.play('move');
    if (k === 'shift') setShift(s => !s);
    else if (k === 'caps') { setCaps(x => !x); setShift(false); }
    else if (k === 'layer') { setLayer(l => (l === 'sym' ? 'abc' : 'sym')); setR(1); }
    else if (k === 'acc') { setLayer(l => (l === 'acc' ? 'abc' : 'acc')); setR(0); }
    else if (k === 'space') insert(' ');
    else if (k === 'left') move(-1);
    else if (k === 'right') move(1);
    else if (k === 'del') del();
    else if (k === 'clear') put('', 0);
    else if (k === 'paste') void clip.mutateAsync().then(t => { const s = (t ?? '').replace(/[\r\n]+/g, ' ').trim(); if (s) insert(s); });
  };
  const press = (ri: number, ci: number) => {
    if (ri < rows.length) { sfx.play('move'); insert(show(rows[ri]![ci]!)); return; }
    special(SPECIAL[ci]![0]);
  };
  const mv = (dr: number, dc: number) => {
    sfx.play('move');
    const nr = (r + dr + nRows) % nRows;
    let nc = dr ? Math.round((c / Math.max(1, width(r) - 1)) * (width(nr) - 1)) : (c + dc + width(r)) % width(r);
    nc = Math.max(0, Math.min(width(nr) - 1, nc));
    setR(nr); setC(nc);
  };
  useEffect(() => { if (r >= nRows) { setR(nRows - 1); setC(0); } else if (c >= width(r)) setC(width(r) - 1); }, [layer]);
  useKeys(k => {
    if (k === 'ArrowUp') mv(-1, 0); else if (k === 'ArrowDown') mv(1, 0);
    else if (k === 'ArrowLeft') mv(0, -1); else if (k === 'ArrowRight') mv(0, 1);
    else if (k === 'Enter') press(r, c);
    else if (k === 'X') { sfx.play('move'); del(); }
    else if (k === 'Y') { sfx.play('move'); insert(' '); }
    else if (k === 'LB') { sfx.play('move'); move(-1); }
    else if (k === 'RB') { sfx.play('move'); move(1); }
    else if (k === 'LT') special('caps');
    else if (k === 'Select') special('layer');
    else if (k === 'Start' || k === 'RT') { sfx.play('ok'); onDone(); }
    else if (k === 'Escape') { sfx.play('back'); onCancel(); }
  });
  const labelOf = (k: Special, l: string) => (k === 'layer' ? (layer === 'sym' ? 'ABC' : '?123') : k === 'acc' && layer === 'acc' ? 'ABC' : l);
  const lit = (k: Special) => (k === 'shift' && shift) || (k === 'caps' && caps) || (k === 'layer' && layer === 'sym') || (k === 'acc' && layer === 'acc');

  return createPortal(
    <div className="osk-ov" onMouseDown={e => e.preventDefault()}>
      <div className="osk">
        <div className="osk-v"><small>{label}</small><b>{value.slice(0, at)}<i />{value.slice(at)}</b></div>
        {rows.map((row, ri) => (
          <div key={layer + ri} className="osk-r">{[...row].map((ch, ci) => (
            <button key={ch + ci} className={ri === r && ci === c ? 'on' : ''} onClick={() => { setR(ri); setC(ci); press(ri, ci); }}>{show(ch)}</button>
          ))}</div>
        ))}
        <div className="osk-r sp">{SPECIAL.map(([k, l], ci) => (
          <button key={k} className={`${k} ${r === rows.length && ci === c ? 'on' : ''} ${lit(k) ? 'lit' : ''}`} onClick={() => { setR(rows.length); setC(ci); special(k); }}>{labelOf(k, l)}</button>
        ))}</div>
        <div className="osk-h">
          <span><Glyph a="ok" />{tt('Tecla')}</span><span><Glyph a="x" />{tt('Apagar')}</span><span><Glyph a="y" />{tt('Espaço')}</span>
          <span><Glyph a="lb" /><Glyph a="rb" />{tt('Cursor')}</span><span><Glyph a="lt" />{tt('Caps')}</span><span><Glyph a="sel" />{tt('Símbolos')}</span>
          <span><Glyph a="menu" />{tt('OK')}</span><span><Glyph a="back" />{tt('Fechar')}</span>
        </div>
      </div>
    </div>,
    document.getElementById('tv') ?? document.body,
  );
}
