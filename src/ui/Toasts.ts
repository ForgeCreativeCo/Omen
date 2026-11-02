import type { DissentEndReason, SimEvent } from '../sim/events';
import { featureLabel } from '../sim/omens/context';
import { CRIME_TEXT, EXODUS_TEXT, LAW_TEXT, REGION_TEXT, SENTENCE_TEXT, whenJudged } from './describe';
import { TUNING } from '../sim/tuning';
import { MILESTONES } from '../sim/milestones';
import type { Sim } from '../sim/Sim';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How a Doubter's or False Prophet's movement ends. */
const END_TEXT: Record<DissentEndReason, string> = {
  converted: 'saw a wonder with their own eyes, and believes again.',
  recanted: 'woke from a dream and recanted.',
  discredited: 'has been shown up as a false prophet. The followers drift back.',
  died: 'is dead. The followers drift back.',
  gone: 'is gone. The followers drift back.',
};

const CAUSE: Record<string, string> = {
  oldAge: 'died of old age',
  starvation: 'starved',
  fire: 'was lost to fire',
  lightning: 'was struck by lightning',
  flood: 'drowned',
  meteor: 'was killed by the falling star',
  thrown: 'was hurled down by the god',
  crushed: 'was crushed by what the god threw',
  battle: 'fell in battle',
  executed: 'was put to death',
  quake: 'was crushed when the earth shook',
  firestorm: 'was burned by the fire from the sky',
  plague: 'died of the sickness',
  sacrificed: 'was given to the god at the fire',
};

/** Short-lived notices for notable moments. Rate-limited so 16× stays readable. */
export class Toasts {
  private readonly el: HTMLElement;
  /** -1 until the first update: start from now (a loaded game doesn't replay its past). */
  private lastSeq = -1;
  /** Deaths from one falling star counted so far (tick, count): past a few, its summary speaks for them. */
  private starDeaths = { tick: -1, n: 0 };
  private recent: number[] = [];

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toasts';
    root.appendChild(this.el);
  }

  show(html: string): void {
    const now = performance.now();
    this.recent = this.recent.filter((t) => now - t < 4000);
    if (this.recent.length >= 4) return;
    this.recent.push(now);
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    this.el.prepend(t);
    setTimeout(() => t.classList.add('out'), 5200);
    setTimeout(() => t.remove(), 6000);
  }

  update(sim: Sim): void {
    if (this.lastSeq < 0) this.lastSeq = sim.events.lastSeq;
    for (const e of sim.events.since(this.lastSeq)) {
      const t = e.tribe !== undefined ? sim.tribes[e.tribe] : undefined;
      const msg = this.describe(t?.view ?? sim, e);
      if (msg) this.show(t && sim.tribes.length > 1 ? `<small class="toast-tribe" style="color:#${t.color.toString(16).padStart(6, '0')}">${t.name}</small> ${msg}` : msg);
    }
    this.lastSeq = sim.events.lastSeq;
  }

  private describe(sim: Sim, e: SimEvent): string | null {
    const who = (id: number) => `<b>${sim.villagers.byId(id)?.name ?? 'Someone'}</b>`;
    switch (e.type) {
      case 'death':
        // A killing has its own notice.
        if (e.cause === 'killed' || e.cause === 'executed') return null;
        // A falling sky kills by the dozen: name a few, the rest are in its own notice.
        if (e.cause === 'meteor') {
          if (this.starDeaths.tick !== e.tick) this.starDeaths = { tick: e.tick, n: 0 };
          if (++this.starDeaths.n > 3) return null;
        }
        return `${who(e.id)} ${CAUSE[e.cause] ?? 'died'}.`;
      case 'killing':
        return e.seen
          ? `<b>${who(e.killer)} killed ${who(e.victim)}</b> in front of everyone.`
          : `${who(e.victim)} has been found dead. <small>(You saw: it was ${who(e.killer)}.)</small>`;
      case 'affairExposed':
        return `${who(e.by)} found out about ${who(e.a)} and ${who(e.b)}.${e.breakup ? ' They have parted.' : ''}`;
      case 'war':
        return e.ally !== undefined
          ? `<b>War.</b> ${cap(sim.tribes[e.ally === e.a ? e.b : e.a]?.name ?? 'a people')} join their allies' war.`
          : `<b>War.</b> ${cap(sim.tribes[e.a]?.name ?? 'a people')} and ${sim.tribes[e.b]?.name ?? 'a people'} have taken up arms against each other.`;
      case 'peace':
        return `<b>Peace</b> between ${sim.tribes[e.a]?.name ?? 'a people'} and ${sim.tribes[e.b]?.name ?? 'a people'}.${e.freed?.length ? ` ${e.freed.length} captive${e.freed.length > 1 ? 's go' : ' goes'} home.` : ''}`;
      case 'alliance':
        return `${cap(sim.tribes[e.a]?.name ?? 'a people')} and ${sim.tribes[e.b]?.name ?? 'a people'} stand together against ${sim.tribes[e.against]?.name ?? 'a common enemy'}.`;
      case 'allianceEnd':
        return `The alliance of ${sim.tribes[e.a]?.name ?? 'a people'} and ${sim.tribes[e.b]?.name ?? 'a people'} is over.`;
      case 'captured':
        return `${cap(sim.tribes[e.by]?.name ?? 'the raiders')} carry off ${e.ids.map(who).join(' and ')}.`;
      case 'conquest':
        return e.outcome === 'driven'
          ? `<b>Conquest.</b> ${cap(sim.tribes[e.winner]?.name ?? 'a people')} have driven ${sim.tribes[e.loser]?.name ?? 'their enemies'} from their land.`
          : `<b>Conquest.</b> ${cap(sim.tribes[e.loser]?.name ?? 'a people')} submit to ${sim.tribes[e.winner]?.name ?? 'their conquerors'} and live under them now.`;
      case 'prayForVictory':
        return `${cap(sim.tribes[e.tribe]?.name ?? 'a people')} pray to you for victory over ${sim.tribes[e.against]?.name ?? 'their enemies'}.`;
      case 'prayerAnswered':
        return e.answered
          ? `${cap(sim.tribes[e.tribe]?.name ?? 'a people')} believe you answered their prayer: you struck ${sim.tribes[e.against]?.name ?? 'their enemies'}.`
          : `${cap(sim.tribes[e.tribe]?.name ?? 'a people')} prayed for victory, and you struck them instead. Their heart for war falters.`;
      case 'raid':
        return `${cap(sim.tribes[e.from]?.name ?? 'a people')} march on ${sim.tribes[e.to]?.name ?? 'a people'}: ${e.ids.length} fighters.`;
      case 'battle':
        return `<b>Raiders at the fire of ${sim.tribes[e.to]?.name ?? 'a people'}!</b>`;
      case 'raidEnd': {
        const parts = [`${e.raidersLost + e.defendersLost} dead`];
        if (e.loot) parts.push(`${e.loot} food carried off`);
        if (e.burned) parts.push('a hut set burning');
        return `The raid of ${sim.tribes[e.from]?.name ?? 'a people'} on ${sim.tribes[e.to]?.name ?? 'a people'} is over: ${parts.join(', ')}.`;
      }
      case 'absorbed':
        return `The last of ${sim.tribes[e.from]?.name ?? 'a people'} have gone to live with ${sim.tribes[e.into]?.name ?? 'a people'}.`;
      case 'calling': {
        const t = sim.tribes[e.tribe];
        const place = t?.myth.places.name(e.place) ?? 'the ground the god marked out';
        return `${e.ids.length} of ${t?.name ?? 'a people'} are leaving for <b>${place}</b>, the ground the god marked out, to live there.`;
      }
      case 'callingEnd':
        return `The believers of ${sim.tribes[e.tribe]?.name ?? 'a people'} turned back: too few were left to settle the hallowed ground.`;
      case 'voyage':
        return `${e.ids.length} of ${sim.tribes[e.tribe]?.name ?? 'a people'} are going down to the shore, to sail for an island.`;
      case 'setSail':
        return `A boat puts to sea from the land of ${sim.tribes[e.tribe]?.name ?? 'a people'}.`;
      case 'castaways': {
        const all = e.ids.map(who);
        const names = all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}` : all.join('');
        if (e.founded) return `<b>A boat was wrecked on the coast.</b> ${names} came ashore to an empty land, and make a home of their own: ${sim.tribes[e.tribe]?.name ?? 'a new people'}.`;
        return `<b>A boat was wrecked on the coast.</b> ${names} came ashore, strangers, and go to live with ${sim.tribes[e.tribe]?.name ?? 'the people'}.`;
      }
      case 'created': {
        const [a, b] = e.ids;
        if (e.founded) return `<b>From the earth you made ${who(a!)} and ${who(b!)}.</b> They are the first of a new people: ${sim.tribes[e.tribe]?.name ?? 'a new people'}.`;
        return `<b>From the earth you made ${who(a!)} and ${who(b!)}.</b> They go to live with ${sim.tribes[e.tribe]?.name ?? 'the people'}.`;
      }
      case 'tribeFounded': {
        // Strangers have their own notice.
        if (e.reason === 'castaways' || e.reason === 'created') return null;
        const from = sim.tribes[e.from];
        if (e.reason === 'settlers') return `<b>A new people:</b> ${e.name}, sailed from ${from?.name ?? 'the main island'}, have settled an island off the coast.`;
        if (e.reason === 'hallowed') {
          const place = sim.tribes[e.id]?.myth.places.siteAt(e.x, e.z);
          const name = place ? sim.tribes[e.id]?.myth.places.name(place.key) : undefined;
          return `<b>A new people:</b> ${e.name}, kin of ${from?.name ?? 'their people'}, have settled ${name ?? 'the hallowed ground'}${e.leaderId >= 0 ? `, led by ${who(e.leaderId)}` : ''}.`;
        }
        return `<b>A new people:</b> ${e.name}${e.leaderId >= 0 ? `, led by ${who(e.leaderId)},` : ''} broke away from ${from?.name ?? 'their people'} and settled in ${REGION_TEXT[sim.island.region[e.x + e.z * sim.world.sizeX] ?? 0] ?? 'new country'}.`;
      }
      case 'exodus':
        return `<b>The village is abandoned.</b> ${EXODUS_TEXT[e.reason]} The survivors set out for ${REGION_TEXT[e.region] ?? 'new ground'}.`;
      case 'accused':
        return `${who(e.accused)} is accused of ${CRIME_TEXT[e.crime]}. The village will judge at ${whenJudged(sim, e)}, <i>unless the god speaks</i>.${e.actual !== e.accused ? ` <small>(You know it was ${who(e.actual)}.)</small>` : ''}`;
      case 'verdict':
        if (e.by === 'godPunished') return `The god struck at ${who(e.accused)} before the village could judge.`;
        if (e.by === 'godPardoned') return `The god touched ${who(e.accused)}: they are spared.`;
        return `${who(e.accused)} ${SENTENCE_TEXT[e.sentence]} for ${CRIME_TEXT[e.crime]}.${e.actual !== e.accused && e.sentence !== 'forgiven' ? ' <small>(They were innocent.)</small>' : ''}`;
      case 'law':
        return `<b>A law is written.</b> Whoever is guilty of ${CRIME_TEXT[e.crime]} ${LAW_TEXT[e.sentence]}.`;
      case 'feud':
        return `${who(e.a)} and ${who(e.b)} are now bitter enemies.`;
      case 'birth':
        return `${who(e.id)} was born.`;
      case 'rainStart':
        return e.storm ? 'A storm rolls in.' : null;
      case 'droughtStart':
        return 'The rains have stopped. A drought begins.';
      case 'droughtEnd':
        return 'The drought breaks.';
      case 'fireStarted':
        return 'Fire!';
      case 'beliefLevel': {
        const b = sim.belief.beliefs.get(e.beliefId);
        if (!b || b.type === 'TEMPERAMENT') return null;
        if (e.level === 'behavior') return `A new belief has taken hold: <i>${sim.belief.statement(b)}</i>`;
        if (e.level === 'doctrine') return `Now doctrine: <i>${sim.belief.statement(b)}</i>`;
        return null;
      }
      case 'priest':
        return e.id >= 0 ? `${who(e.id)} is now the high priest <small>(${e.personality})</small>.` : null;
      case 'prophecy': {
        const b = sim.belief.beliefs.get(e.beliefId);
        return b ? `The priest foretells ${e.good ? 'good fortune' : 'hard times'}: <i>${sim.belief.statement(b)}</i>` : null;
      }
      case 'exiled':
        return e.left ? null : `${who(e.id)} has been sent away.`;
      case 'silence':
        return 'They have seen no wonder in a long while. <i>Where has the god gone?</i>';
      case 'dissent':
        return e.kind === 'doubter'
          ? `${who(e.id)} says there is no god, only weather. <small>(a Doubter)</small>`
          : `${who(e.id)} claims to speak for the god${e.rule ? `, and forbids ${featureLabel(sim, e.rule)}` : ''}. <small>(a False Prophet)</small>`;
      case 'dissentEnd':
        return `${who(e.id)} ${END_TEXT[e.reason]}`;
      case 'prophetClaims':
        return `${who(e.id)} claims the wonder as their own doing.`;
      case 'prophesied':
        return `${who(e.id)} foretells rain within ${TUNING.dissent.prophecyDays} days.`;
      case 'prophecyResult':
        return e.fulfilled ? `Rain came, as ${who(e.id)} foretold. More listen.` : `${who(e.id)}'s prophecy failed. Some stop listening.`;
      case 'schism':
        return e.outcome === 'split'
          ? `<b>The village has split.</b> ${who(e.leaderId)} leads ${e.ids.length - 1} away to live without you.`
          : `The faithful have driven ${who(e.leaderId)} out of the village.`;
      case 'dream':
        return `${who(e.villagerId)} stirs in their sleep.`;
      case 'blessing':
        return `${who(e.villagerId)} glows.`;
      case 'anointed':
        return `<b>You have anointed ${who(e.id)}.</b> A pillar of light came down on them, and ${e.witnesses.length} saw it.`;
      case 'messiahCredited':
        return `They say ${who(e.id)} did it.`;
      case 'messiahJourney':
        return `${who(e.id)} sets out to preach to ${sim.tribes[e.to]?.name ?? 'another people'}.`;
      case 'messiahPreachedAbroad':
        return e.came ? `${who(e.id)} preached to ${sim.tribes[e.to]?.name ?? 'another people'}, and <b>${e.came}</b> came away with them.` : `${who(e.id)} preached to ${sim.tribes[e.to]?.name ?? 'another people'}. None followed.`;
      case 'messiahDied':
        return e.death === 'saint'
          ? `<b>${who(e.id)} is dead.</b> Where they lie is holy now. For three days, the Hand can still raise them.`
          : e.death === 'martyr'
            ? `<b>${who(e.id)} has been killed.</b> A martyr. For three days, the Hand can still raise them.`
            : `<b>You struck down ${who(e.id)}.</b> Some say you called them home; some, that you abandoned them. For three days, the Hand can still raise them.`;
      case 'messiahBuried':
        return `${who(e.id)} has been buried.`;
      case 'messiahRisen':
        return `<b>${who(e.id)} has risen.</b> ${e.witnesses} saw it${e.came ? `, and ${e.came} of other peoples came to them` : ''}.`;
      case 'prayer': {
        const t = sim.tribes[e.tribe ?? 0];
        const of = sim.tribes.length > 1 && t ? ` of ${t.name}` : '';
        const what: Record<string, string> = {
          rain: 'for rain',
          harvest: 'for food',
          heal: `for ${who(e.for)} to be healed`,
          child: 'for a child',
          vengeance: `for vengeance on ${sim.tribes[e.against]?.name ?? 'their enemies'}`,
          guidance: 'for a new land to live in',
          mercy: 'for mercy',
        };
        return `${who(e.asker)}${of} prays ${what[e.kind]}.`;
      }
      case 'prayerEnd':
        if (e.end === 'answered') return `You answered ${who(e.asker)}'s prayer.`;
        if (e.end === 'luck') return `${who(e.asker)}'s prayer came true. They thank you for it.`;
        if (e.end === 'defied') return `${who(e.asker)} prayed, and you struck them.`;
        if (e.end === 'lost') return `${who(e.asker)}'s prayer came too late.`;
        return `No answer came to ${who(e.asker)}.`;
      case 'blessPlace':
        return e.kind === 'field' ? 'Light settles on a field.' : e.residents.length ? `Light settles on the home of ${e.residents.slice(0, 2).map((id) => who(id)).join(' and ')}${e.residents.length > 2 ? ' and theirs' : ''}.` : 'Light settles on an empty home.';
      case 'meteorFall':
        return e.big ? '<b>The sky is falling.</b>' : 'A star is falling.';
      case 'cataclysm': {
        const gone = e.villages.map((id) => sim.tribes[id]?.name).filter(Boolean);
        return gone.length
          ? `<b>The sky fell on ${gone.join(' and ')}.</b> ${e.killed.length} dead; nothing stands where their village was.`
          : `<b>The sky fell.</b> ${e.killed.length ? `${e.killed.length} dead.` : 'Nobody lived there.'}`;
      }
      case 'quake':
        return '<b>The earth shakes.</b>';
      case 'quakeEnd':
        return e.wrecked.length || e.killed.length ? `The shaking stops. ${e.wrecked.length} ${e.wrecked.length === 1 ? 'building' : 'buildings'} damaged${e.killed.length ? `, ${e.killed.length} dead` : ''}.` : null;
      case 'firestorm':
        return '<b>Fire is falling from the sky.</b>';
      case 'wave':
        return '<b>The sea is rising up.</b> A wave is coming in.';
      case 'waveEnd':
        return e.carried.length || e.crops || e.wrecked.length ? `The wave breaks${e.carried.length ? `, sweeping ${e.carried.length} away` : ''}${e.crops ? `, drowning ${e.crops} rows of crops` : ''}.` : null;
      case 'swarm':
        return `<b>A swarm</b> descends on the fields of ${sim.tribes[e.tribe]?.name ?? 'a people'}.`;
      case 'swarmEnd':
        return e.eaten || e.food ? `The swarm has gone, and ${e.eaten} rows of crops${e.food ? ` and ${e.food} food` : ''} with it.` : null;
      case 'greatOffering':
        return e.why === 'rivalry' ? `They burn ${e.amount} food at the fire, to win your favor.` : `<b>A great offering:</b> ${e.amount} food burned at the fire, to turn your anger.`;
      case 'sacrifice':
        return `<b>${who(e.priest)} has given ${who(e.id)} to you at the fire.</b>${e.ritual ? ' It is their custom now.' : ' They dread what you will do next.'}`;
      case 'defiance':
        return `${who(e.id)} will not bow to you${e.griefFor >= 0 ? `, not after what you did to ${who(e.griefFor)}` : ''}.`;
      case 'vindicated':
        return `You have done nothing to ${who(e.id)}. Others begin to listen.`;
      case 'defianceEnd':
        return e.reason === 'struck' ? `${who(e.id)} defied you, and fell. The people are afraid.` : e.reason === 'humbled' ? `${who(e.id)} defies you no longer.` : null;
      case 'rivalry': {
        const other = sim.tribes[e.other]?.name ?? 'their neighbors';
        return e.kind === 'scorn' ? `They say ${other} must have angered you. They give more, lest they be next.` : `Why do you favor ${other}? They give more, to win you back.`;
      }
      case 'plague':
        return e.ids.length ? `${e.ids.slice(0, 3).map(who).join(', ')}${e.ids.length > 3 ? ` and ${e.ids.length - 3} more` : ''} ${e.ids.length === 1 ? 'has' : 'have'} fallen sick.` : null;
      case 'milestone': {
        const m = MILESTONES.find((x) => x.id === e.id);
        return m ? `<span class="toast-purpose">Purpose fulfilled: <b>${m.title}</b></span>` : null;
      }
      case 'tradition': {
        const b = sim.belief.beliefs.get(e.beliefId);
        return b ? `The last who saw it are gone. Now tradition: <i>${sim.belief.statement(b)}</i>` : null;
      }
      case 'placeNamed':
        return `The people now speak of <b>${e.name}</b>.`;
      case 'godNamed':
        return e.old ? `They no longer say ${e.old}. The god is now <b>${e.name}</b>.` : `The people have named the god: <b>${e.name}</b>.`;
      case 'built':
        if (e.kind === 'statue') return `A statue of ${sim.myth.god} stands finished.`;
        if (e.kind === 'shrine' || e.kind === 'temple' || e.kind === 'cairn') return `The people have raised a ${e.kind}.`;
        if (e.kind === 'storehouse') return 'The people have built a storehouse: their food will keep longer.';
        if (e.variant === 'longhouse') return 'A longhouse stands: the village has grown prosperous.';
        return null;
      case 'flood':
        return e.phase === 'strike' ? '<b>The sea is rising.</b>' : e.phase === 'peak' ? 'The water has stopped rising.' : null;
      case 'ruined':
        return 'The old statue is left to weather.';
      case 'destroyed':
        // A fence knocked flat isn't news.
        return e.kind === 'fence' ? null : `A ${e.kind} was destroyed.`;
      default:
        return null;
    }
  }
}
