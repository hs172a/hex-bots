export interface EmpireInfo { name: string; icon: string; }

const EMPIRE_MAP: Record<string, EmpireInfo> = {
  solarian:                    { name: 'Solarian Confederacy',    icon: '☀️' },
  'solarian confederacy':      { name: 'Solarian Confederacy',    icon: '☀️' },
  voidborn:                    { name: 'Voidborn Collective',     icon: '🌑' },
  'voidborn collective':       { name: 'Voidborn Collective',     icon: '🌑' },
  crimson:                     { name: 'Crimson Pact',            icon: '⚔️' },
  'crimson pact':              { name: 'Crimson Pact',            icon: '⚔️' },
  nebula:                      { name: 'Nebula Trade Federation', icon: '🌌' },
  'nebula trade federation':   { name: 'Nebula Trade Federation', icon: '🌌' },
  outerrim:                    { name: 'Outer Rim Explorers',     icon: '🔭' },
  'outer rim':                 { name: 'Outer Rim Explorers',     icon: '🔭' },
  'outer rim explorers':       { name: 'Outer Rim Explorers',     icon: '🔭' },
};

export function getEmpire(empire: string | undefined): EmpireInfo | null {
  if (!empire) return null;
  return EMPIRE_MAP[empire.toLowerCase()] ?? null;
}

export function empireIcon(empire: string | undefined): string {
  return getEmpire(empire)?.icon ?? '';
}

export function empireName(empire: string | undefined): string {
  return getEmpire(empire)?.name ?? empire ?? '';
}
