/**
 * Shapes raw content and events into the app's types: keeps only known fields, trims text, and fills
 * anything missing with an empty default. Shared by the publisher (sanitize.ts) and by the guest app
 * (payload.ts) so an old or partial copy of the data can never crash a page.
 * (Kept free of the forbidden-term list so it can ship in the browser bundle.)
 */
import type { Content, EventInfo, MealItem } from './types';

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);

export function pickEvents(raw: unknown): EventInfo[] {
  if (!Array.isArray(raw)) return [];
  // Allowlist: only these keys survive, whatever else the source file contains.
  return raw.map((e) => {
    const out: EventInfo = {
    id: str(e?.id),
    name: str(e?.name),
    start: str(e?.start),
    end: str(e?.end),
    venue: str(e?.venue),
    address: str(e?.address),
    dressCode: str(e?.dressCode),
    dressNotes: str(e?.dressNotes),
    description: str(e?.description),
    };
    if (Array.isArray(e?.moments)) {
      const m = e.moments
        .map((x: any) => ({ time: str(x?.time), label: str(x?.label) }))
        .filter((x: { time: string; label: string }) => x.time && x.label);
      if (m.length) out.moments = m;
    }
    if (str(e?.area)) out.area = str(e.area);
    if (e?.timeTbd === true) out.timeTbd = true;
    if (e?.everyone === true) out.everyone = true;
    return out;
  });
}

export function pickContent(raw: any): Content {
  return {
    coupleNames: str(raw?.coupleNames),
    tagline: str(raw?.tagline),
    timezone: str(raw?.timezone),
    welcome: str(raw?.welcome),
    faq: Array.isArray(raw?.faq) ? raw.faq.map((f: any) => ({ q: str(f?.q), a: str(f?.a) })) : [],
    contact: { label: str(raw?.contact?.label), detail: str(raw?.contact?.detail) },
    updates: Array.isArray(raw?.updates)
      ? raw.updates.map((u: any) => ({ id: str(u?.id), at: str(u?.at), message: str(u?.message) }))
      : [],
    program: {
      intro: str(raw?.program?.intro),
      sections: list(raw?.program?.sections).map((x: any) => ({ title: str(x?.title), body: str(x?.body) })).filter((x) => x.title || x.body),
    },
    meals: {
      intro: str(raw?.meals?.intro),
      items: list(raw?.meals?.items)
        .map((x: any) => {
          const item: MealItem = { label: str(x?.label) };
          // Values are kept as written so publish-time validation can reject typos; `menu` is never read.
          for (const k of ['eventId', 'date', 'start', 'end', 'time', 'place', 'jain', 'notes'] as const) if (str(x?.[k])) (item as unknown as Record<string, string>)[k] = str(x[k]);
          return item;
        })
        .filter((x) => x.label && (x.eventId || x.date)),
    },
    rides: {
      intro: str(raw?.rides?.intro),
      steps: list(raw?.rides?.steps).map((x: unknown) => str(x)).filter(Boolean),
      voucher: { code: str(raw?.rides?.voucher?.code), note: str(raw?.rides?.voucher?.note) },
      tips: list(raw?.rides?.tips).map((x: unknown) => str(x)).filter(Boolean),
    },
    map: pickMap(raw?.map),
    weather: pickWeather(raw?.weather),
  };
}

const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function pickMap(m: any): Content['map'] {
  const out: Content['map'] = {
    intro: str(m?.intro),
    places: list(m?.places)
      .map((x: any) => {
        const place: Content['map']['places'][number] = { name: str(x?.name), address: str(x?.address) };
        if (str(x?.note)) place.note = str(x.note);
        return place;
      })
      .filter((x) => x.name && x.address),
  };
  if (str(m?.imagePath)) out.imagePath = str(m.imagePath);
  if (str(m?.imageAlt)) out.imageAlt = str(m.imageAlt);
  const spots = list(m?.spots)
    .map((x: any) => ({ letter: str(x?.letter).toUpperCase(), x: Number(x?.x), y: Number(x?.y) }))
    .filter((s) => /^[A-Z]$/.test(s.letter) && s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100);
  if (spots.length) out.spots = spots;
  return out;
}

function pickWeather(w: any): Content['weather'] {
  const lat = Number(w?.latitude);
  const lon = Number(w?.longitude);
  if (!w || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { place: str(w.place, 'the venue'), latitude: lat, longitude: lon };
}

