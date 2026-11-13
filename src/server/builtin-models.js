// @ts-check
// One installation/status surface for the two cooperating built-in models.
const { setTimeout: delay } = require('node:timers/promises');

function createBuiltinModels({ minicpm, laya, selected = () => true }) {
  let job = null, generation = 0;
  const requireBuiltin = () => { if (!selected()) throw new Error('Select the built-in provider to use local models.'); };
  async function state() {
    const [mini, routing] = await Promise.all([minicpm.state(), laya.state()]);
    return { ...mini, supported: mini.supported && routing.supported, installed: mini.installed && routing.installed,
      minicpmInstalled: mini.installed, laya: routing,
      pulling: job && !job.done ? { percent: job.percent, status: job.status, elapsedSeconds: job.elapsedSeconds || 0 } : null,
      error: job?.error || routing.error || mini.error || '' };
  }
  async function install(component, label, base, share) {
    requireBuiltin();
    await component.startPull();
    for (;;) {
      requireBuiltin();
      const value = await component.state();
      if (!value.pulling) { if (!value.installed) throw new Error(value.error || `${label} installation incomplete.`); break; }
      job.status = `${label}: ${value.pulling.status}`;
      job.percent = Number.isFinite(value.pulling.percent) ? base + Math.floor(value.pulling.percent * share) : null;
      job.elapsedSeconds = value.pulling.elapsedSeconds || 0;
      await delay(100);
    }
  }
  async function startPull() {
    requireBuiltin();
    if (!job || job.done) {
      job = { done: false, percent: null, status: 'Preparing Laya and MiniCPM', error: '' };
      (async () => {
        try { await install(laya, 'Laya', 0, 0.5); await install(minicpm, 'MiniCPM', 50, 0.5); job.percent = 100; }
        catch (error) { job.error = String(error.message).slice(-2000); }
        finally { job.done = true; }
      })();
    }
    return state();
  }
  return { state, startPull,
    ensure: async signal => {
      requireBuiltin(); const before = generation;
      if (!(await laya.state()).installed) throw new Error('Download Laya and MiniCPM in the assistant settings first.');
      requireBuiltin();
      if (before !== generation) throw Object.assign(new Error('Built-in models stopped.'), { name: 'AbortError' });
      return minicpm.ensure(signal);
    },
    configure: next => minicpm.configure?.(next), touch: () => minicpm.touch(),
    stop: () => { generation++; minicpm.stop?.(); laya.stop?.(); }
  };
}
module.exports = { createBuiltinModels };
