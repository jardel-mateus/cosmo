import { copyFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MessageBus } from 'dbus-next';

type Dbus = typeof import('dbus-next');
let lib: Dbus | null = null;
const dbus = () => (lib ??= require('dbus-next') as Dbus);
import { tt } from '@shared/i18n';

const DEST = 'org.freedesktop.portal.Desktop', ROOT = '/org/freedesktop/portal/desktop';
const SHOT_XML = `<node><interface name="org.freedesktop.portal.Screenshot">
<method name="Screenshot"><arg type="s" name="parent_window" direction="in"/><arg type="a{sv}" name="options" direction="in"/><arg type="o" name="handle" direction="out"/></method>
</interface></node>`;
const REQ_XML = `<node><interface name="org.freedesktop.portal.Request">
<method name="Close"/>
<signal name="Response"><arg type="u" name="response"/><arg type="a{sv}" name="results"/></signal>
</interface></node>`;

export class Portal {
  private bus: MessageBus | null = null;
  private seq = 0;
  err = '';

  private async connect() {
    if (this.bus) return this.bus;
    const bus = dbus().sessionBus();
    bus.on('error', e => { this.err = String(e); if (this.bus === bus) this.bus = null; });
    if (!(bus as unknown as { name?: string }).name) await new Promise<void>((ok, fail) => { const t = setTimeout(() => fail(new Error(tt('sem conexão com o D-Bus da sessão'))), 5000); bus.once('connect', () => { clearTimeout(t); ok(); }); });
    this.bus = bus;
    return bus;
  }

  async screenshot(file: string, timeout = 20_000): Promise<boolean> {
    try {
      const bus = await this.connect();
      const token = `cartucho${process.pid}_${++this.seq}`;
      const sender = ((bus as unknown as { name?: string }).name ?? '').replace(/^:/, '').replace(/\./g, '_');
      const path = `${ROOT}/request/${sender}/${token}`;
      const req = (await bus.getProxyObject(DEST, path, REQ_XML)).getInterface('org.freedesktop.portal.Request');
      const answer = new Promise<{ code: number; uri: string | null }>((ok, fail) => {
        const t = setTimeout(() => fail(new Error(tt('o sistema não respondeu ao pedido de captura'))), timeout);
        req.once('Response', (code: number, results: Record<string, { value: unknown }>) => {
          clearTimeout(t);
          ok({ code, uri: typeof results?.uri?.value === 'string' ? results.uri.value : null });
        });
      });
      const shot = (await bus.getProxyObject(DEST, ROOT, SHOT_XML)).getInterface('org.freedesktop.portal.Screenshot');
      const { Variant } = dbus();
      await shot.Screenshot!('', { handle_token: new Variant('s', token), interactive: new Variant('b', false), modal: new Variant('b', false) });
      const { code, uri } = await answer;
      if (code !== 0 || !uri) { this.err = code === 1 ? tt('a captura foi negada no sistema') : tt('o sistema não fez a captura ({0})', { 0: code }); return false; }
      const src = fileURLToPath(uri);
      copyFileSync(src, file);
      try { unlinkSync(src); } catch { }
      return true;
    } catch (e) {
      this.err = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  stop() { try { this.bus?.disconnect(); } catch { } this.bus = null; }
}
