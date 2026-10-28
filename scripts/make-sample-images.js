// Generates simple neutral PLACEHOLDER illustrations for the sample catalog. Replace with real product photos via Admin > Products.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img', 'sample');
const wrap = (bg, inner, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="${label}"><rect width="400" height="400" fill="${bg}"/>${inner}<text x="200" y="382" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#8a94a6">Sample placeholder image</text></svg>`;
const shapes = {
  phone: (c) => `<rect x="130" y="50" width="140" height="290" rx="22" fill="#1b2433"/><rect x="140" y="64" width="120" height="262" rx="14" fill="${c}"/><circle cx="200" cy="76" r="4" fill="#1b2433"/>`,
  headphones: (c) => `<path d="M110 230v-40a90 90 0 0 1 180 0v40" fill="none" stroke="#1b2433" stroke-width="18"/><rect x="92" y="215" width="44" height="86" rx="18" fill="${c}"/><rect x="264" y="215" width="44" height="86" rx="18" fill="${c}"/>`,
  laptop: (c) => `<rect x="90" y="90" width="220" height="150" rx="8" fill="#1b2433"/><rect x="100" y="100" width="200" height="130" rx="3" fill="${c}"/><path d="M60 250h280l-20 24H80z" fill="#c5ccd8"/>`,
  watch: (c) => `<rect x="165" y="40" width="70" height="80" fill="#2a3446"/><rect x="165" y="280" width="70" height="80" fill="#2a3446"/><rect x="140" y="110" width="120" height="180" rx="34" fill="#1b2433"/><rect x="150" y="122" width="100" height="156" rx="26" fill="${c}"/>`,
  dress: (c) => `<path d="M170 60h60l12 80 48 190H110l48-190z" fill="${c}"/><path d="M170 60q30 30 60 0" fill="none" stroke="#1b2433" stroke-width="6"/>`,
  fryer: (c) => `<rect x="110" y="70" width="180" height="250" rx="40" fill="#1b2433"/><rect x="130" y="100" width="140" height="70" rx="12" fill="${c}"/><circle cx="200" cy="240" r="32" fill="#2e394d"/>`,
  tv: (c) => `<rect x="50" y="90" width="300" height="190" rx="8" fill="#1b2433"/><rect x="60" y="100" width="280" height="170" fill="${c}"/><rect x="170" y="280" width="60" height="30" fill="#8a94a6"/><rect x="130" y="310" width="140" height="10" rx="5" fill="#8a94a6"/>`,
  speaker: (c) => `<rect x="130" y="60" width="140" height="270" rx="24" fill="#1b2433"/><circle cx="200" cy="130" r="30" fill="${c}"/><circle cx="200" cy="245" r="52" fill="${c}"/>`,
  shoe: (c) => `<path d="M60 250c40-10 60-50 80-80l40 20c30 14 70 18 160 30v40H60z" fill="${c}"/><rect x="60" y="280" width="280" height="22" rx="10" fill="#1b2433"/>`,
  book: (c) => `<rect x="120" y="60" width="170" height="260" rx="6" fill="${c}"/><rect x="120" y="60" width="18" height="260" fill="#1b2433"/><rect x="160" y="110" width="100" height="10" fill="#fff" opacity=".8"/><rect x="160" y="135" width="70" height="10" fill="#fff" opacity=".8"/>`,
  bottle: (c) => `<rect x="170" y="50" width="60" height="40" rx="8" fill="#1b2433"/><rect x="150" y="90" width="100" height="240" rx="30" fill="${c}"/>`,
  blender: (c) => `<path d="M140 70h120l-14 170h-92z" fill="${c}" opacity=".85"/><rect x="130" y="240" width="140" height="90" rx="14" fill="#1b2433"/><circle cx="200" cy="285" r="14" fill="#f58a07"/>`,
  ball: (c) => `<circle cx="200" cy="190" r="110" fill="${c}"/><path d="M90 190h220M200 80v220M120 112q80 78 160 0M120 268q80-78 160 0" fill="none" stroke="#1b2433" stroke-width="5"/>`,
  toy: (c) => `<rect x="110" y="160" width="180" height="150" rx="16" fill="${c}"/><rect x="140" y="110" width="40" height="50" fill="#f58a07"/><rect x="220" y="110" width="40" height="50" fill="#ffc21a"/>`,
  car: (c) => `<path d="M60 250l30-70h140l50 40h40v30z" fill="${c}"/><circle cx="130" cy="264" r="26" fill="#1b2433"/><circle cx="290" cy="264" r="26" fill="#1b2433"/>`,
  cable: (c) => `<path d="M80 280c60-170 180 40 240-130" fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round"/><rect x="60" y="270" width="36" height="30" rx="6" fill="#1b2433"/><rect x="304" y="130" width="36" height="30" rx="6" fill="#1b2433"/>`,
  placeholder: () => `<rect x="110" y="110" width="180" height="150" rx="14" fill="#e3e8f0"/><circle cx="160" cy="160" r="16" fill="#c5ccd8"/><path d="M120 250l50-50 40 36 30-26 40 40z" fill="#c5ccd8"/>`,
};
const palette = ['#4f8cff', '#f58a07', '#2fbf8f', '#e0527a', '#8f6bff', '#ffc21a', '#35b6d6', '#6b7a99'];
const bgs = ['#eef3fb', '#fff4e6', '#eaf8f2', '#fdeef3', '#f1edff', '#fff9e0'];
let i = 0;
for (const [name, fn] of Object.entries(shapes)) {
  fs.writeFileSync(path.join(out, name + '.svg'), wrap(name === 'placeholder' ? '#f4f6fa' : bgs[i % bgs.length], fn(palette[i % palette.length]), name === 'placeholder' ? 'No image available' : 'Sample product illustration'));
  i++;
}
// Festive hero (original artwork): lamp motifs on a deep navy-to-orange gradient
const lamps = [[820, 90, 1], [900, 320, 0.8], [1000, 140, 0.7], [700, 330, 0.9], [1080, 300, 0.6]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-30 0h60q0 28-30 34q-30-6-30-34z" fill="#f58a07"/><path d="M0-46q14 20 0 38q-14-18 0-38z" fill="#ffc21a"/></g>`).join('');
fs.writeFileSync(path.join(out, 'hero-diwali.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1b33"/><stop offset=".6" stop-color="#2a1a2b"/><stop offset="1" stop-color="#8a3b0a"/></linearGradient><radialGradient id="r" cx=".8" cy=".4" r=".5"><stop offset="0" stop-color="#ffc21a" stop-opacity=".45"/><stop offset="1" stop-color="#ffc21a" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="420" fill="url(#g)"/><rect width="1200" height="420" fill="url(#r)"/>${lamps}</svg>`);
fs.writeFileSync(path.join(out, '..', 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="5" y="13" width="30" height="22" rx="4" fill="#f58a07"/><path d="M12 13a8 8 0 0 1 16 0" fill="none" stroke="#ffc21a" stroke-width="3"/><path d="M21 17l-5 8h4l-1 6 6-9h-4z" fill="#0b1b33"/></svg>`);
console.log('sample images written');
