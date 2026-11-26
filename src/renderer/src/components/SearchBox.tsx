import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { lastInput } from '../lib/input';
import { Osk } from './Osk';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onDone?: () => void;
  className?: string;
  nav?: boolean;
}

export const SearchBox = forwardRef<HTMLInputElement, Props>(({ value, onChange, placeholder, onDone, className = 'search', nav = true }, ref) => {
  const el = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => el.current!, []);
  const [osk, setOsk] = useState(false);
  const close = (done: boolean) => { setOsk(false); el.current?.blur(); if (done) onDone?.(); };
  return (
    <>
      <input ref={el} className={className} data-search data-hf={nav ? true : undefined} placeholder={placeholder} value={value} spellCheck={false}
        onClick={e => e.currentTarget.focus()}
        onFocus={() => { if (lastInput() === 'pad') setOsk(true); }}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); setOsk(false); onDone?.(); }
        }} />
      {osk && <Osk value={value} onChange={onChange} label={placeholder} onDone={() => close(true)} onCancel={() => close(false)} />}
    </>
  );
});
SearchBox.displayName = 'SearchBox';
