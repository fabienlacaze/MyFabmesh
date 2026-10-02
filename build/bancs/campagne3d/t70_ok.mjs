import * as h from './h.mjs';
const m = await h.modale(); const c = (m.data || []).find((x) => x.id === 'modal-confirm');
if (c) console.log('Continue ->', JSON.stringify(await h.clic({ text: 'Continue', within: 'modal-confirm' })).slice(0, 80)); else console.log('pas de confirmation');
