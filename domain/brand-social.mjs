const MERGE_DISTANCE = 24;
const MIN_HUE_GAP = 30;
const VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
const EMOJI = /\p{Extended_Pictographic}/u;

const hex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

function hsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function mergeSimilar(palette) {
  const groups = [];
  for (const c of [...palette].sort((a, b) => b.weight - a.weight)) {
    const g = groups.find((x) => Math.hypot(x.r - c.r, x.g - c.g, x.b - c.b) < MERGE_DISTANCE);
    if (!g) {
      groups.push({ ...c });
      continue;
    }
    const w = g.weight + c.weight;
    g.r = (g.r * g.weight + c.r * c.weight) / w;
    g.g = (g.g * g.weight + c.g * c.weight) / w;
    g.b = (g.b * g.weight + c.b * c.weight) / w;
    g.weight = w;
  }
  return groups.sort((a, b) => b.weight - a.weight);
}

function voiceOf(bio) {
  const text = String(bio ?? '').trim();
  if (!text) return undefined;
  const lang = VI_CHARS.test(text) ? 'Vietnamese' : /[a-z]/i.test(text) ? 'English' : 'unknown language';
  const cues = [EMOJI.test(text) && 'emoji', text.includes('!') && 'exclamations'].filter(Boolean);
  const tone = cues.length ? `informal tone — ${cues.join(', ')}` : 'neutral tone';
  return `${lang}; ${tone} (observed from bio)`;
}

/**
 * Brand observation for a business with only social profiles. `palette` comes from the host
 * (pixel stats of downloaded images). This is an observation, never an official brand.
 */
export function brandFromSocial({ palette = [], bio, name, avatarUrl, avatarAssetId } = {}) {
  const valid = (Array.isArray(palette) ? palette : []).filter((c) => [c?.r, c?.g, c?.b, c?.weight].every(Number.isFinite) && c.weight > 0);
  const merged = mergeSimilar(valid).map((c) => ({ ...c, ...hsl(c) }));
  const chromatic = merged.filter((c) => c.s >= 0.2 && c.l > 0.12 && c.l < 0.92);
  const neutrals = merged.filter((c) => !chromatic.includes(c));

  const colors = [];
  const primary = chromatic[0];
  if (primary) {
    colors.push({ hex: hex(primary), role: 'primary' });
    const accent = chromatic.slice(1).find((c) => {
      const gap = Math.abs(c.h - primary.h);
      return Math.min(gap, 360 - gap) >= MIN_HUE_GAP;
    });
    if (accent) colors.push({ hex: hex(accent), role: 'accent' });
  }
  for (const n of neutrals.slice(0, 2)) colors.push({ hex: hex(n), role: 'neutral' });

  const evidence = [];
  if (valid.length) evidence.push({ kind: 'palette', detail: `${valid.length} colour samples from collected images` });
  if (typeof bio === 'string' && bio.trim()) evidence.push({ kind: 'bio', quote: bio.trim() });
  if (avatarUrl) evidence.push({ kind: 'avatar', url: avatarUrl });

  const out = { origin: 'social', official: false, colors, fonts: [], evidence };
  const voice = voiceOf(bio);
  if (voice) out.voice = voice;
  if (avatarAssetId) out.logo = avatarAssetId;
  if (name) out.name = name;
  return out;
}
