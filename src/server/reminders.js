// Durable deferred reminders. Only identity and timing are trusted from a saved snooze;
// the scheduler supplies current calendar details and rules before delivery.
const crypto = require('node:crypto');
const logic = require('../shared/alert-logic');
const { writeJsonAtomic, readJson } = require('./json-store');
const idFor = occ => occ.key + '|' + occ.start;

function createReminderStore({ file, now = Date.now }) {
  let state = { pending: [], tickets: [], deliveries: [] };
  const saved = readJson(file, {});
  if (['pending', 'tickets', 'deliveries'].every(key => Array.isArray(saved[key]))) state = saved;
  const liveDeliveries = (list, t) => list.filter(s => s.occ.start > t && s.deliveredAt >= t - logic.DELIVERY_WINDOW_MS);
  function commit(next) {
    const t = now();
    next = {
      pending: next.pending.filter(s => s.start > t),
      tickets: next.tickets.filter(s => s.start > t),
      deliveries: liveDeliveries(next.deliveries, t)
    };
    writeJsonAtomic(file, next);
    state = next;
  }
  function schedule(occ) {
    const dueAt = now() + logic.SNOOZE_MS;
    if (!occ || typeof occ.key !== 'string' || !Number.isFinite(occ.start) || dueAt >= occ.start) {
      throw new Error('A five-minute snooze must end before the event starts.');
    }
    const item = { key: occ.key, start: occ.start, dueAt, sourceKeys: occ.sourceKeys };
    commit({ ...state, pending: [...state.pending.filter(s => idFor(s) !== idFor(occ)), item] });
    return item;
  }
  function issueTicket(occ) {
    const token = crypto.randomBytes(24).toString('hex');
    commit({ ...state, tickets: [...state.tickets, { token, key: occ.key, start: occ.start }] });
    return token;
  }
  function consumeTicket(token) {
    const ticket = state.tickets.find(s => s.token === token && s.start > now());
    if (!ticket) throw new Error('This snooze link is invalid, expired or already used.');
    commit({ ...state, tickets: state.tickets.filter(s => s !== ticket) });
    return { key: ticket.key, start: ticket.start };
  }
  function takeDue(occurrences, rules, silent = false) {
    const t = now(), due = [], pending = [];
    const current = new Map(occurrences.map(o => [idFor(o), o]));
    for (const item of state.pending) {
      if (item.start <= t || rules.global.muted) continue;
      const occ = current.get(idFor(item));
      if (occ && !logic.isAlertable(rules, occ)) continue;
      if (!occ || silent || item.dueAt > t) { pending.push(item); continue; }
      due.push({ id: idFor(item) + '|' + item.dueAt, occ, deliveredAt: t });
    }
    if (due.length || pending.length !== state.pending.length) commit({ ...state, pending, deliveries: [...state.deliveries, ...due] });
    return due;
  }
  return {
    schedule, issueTicket, consumeTicket, takeDue,
    horizon: () => Math.max(0, ...state.pending.map(s => s.start - now())),
    status: () => ({
      pending: state.pending.filter(s => s.start > now()).map(s => ({ ...s })),
      deliveries: liveDeliveries(state.deliveries, now()).map(s => ({ ...s }))
    })
  };
}

module.exports = { createReminderStore };
