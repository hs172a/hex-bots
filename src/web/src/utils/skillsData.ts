export interface SkillInfo {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface CategoryInfo {
  id: string;
  label: string;
  icon: string;
  color: string;
  barColor: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'mining',      label: 'Mining',      icon: '⛏️', color: 'text-amber-400',  barColor: 'bg-amber-400' },
  { id: 'ships',       label: 'Ships',        icon: '🚀', color: 'text-blue-400',   barColor: 'bg-blue-400' },
  { id: 'navigation',  label: 'Navigation',   icon: '🧭', color: 'text-sky-400',    barColor: 'bg-sky-400' },
  { id: 'engineering', label: 'Engineering',  icon: '🔧', color: 'text-slate-400',  barColor: 'bg-slate-400' },
  { id: 'crafting',    label: 'Crafting',     icon: '🔨', color: 'text-orange-400', barColor: 'bg-orange-400' },
  { id: 'trading',     label: 'Trading',      icon: '💰', color: 'text-lime-400',   barColor: 'bg-lime-400' },
  { id: 'combat',      label: 'Combat',       icon: '⚔️', color: 'text-red-400',    barColor: 'bg-red-400' },
  { id: 'drones',      label: 'Drones',       icon: '🤖', color: 'text-teal-400',   barColor: 'bg-teal-400' },
  { id: 'exploration', label: 'Exploration',  icon: '🔭', color: 'text-cyan-400',   barColor: 'bg-cyan-400' },
  { id: 'support',     label: 'Support',      icon: '🕵️', color: 'text-gray-400',   barColor: 'bg-gray-400' },
  { id: 'salvaging',   label: 'Salvaging',    icon: '♻️', color: 'text-green-400',  barColor: 'bg-green-400' },
  { id: 'faction',     label: 'Faction',      icon: '⚑',  color: 'text-purple-400', barColor: 'bg-purple-400' },
  { id: 'empire',      label: 'Empire',       icon: '⚜️', color: 'text-yellow-500', barColor: 'bg-yellow-500' },
  { id: 'prestige',    label: 'Prestige',     icon: '👑', color: 'text-yellow-400', barColor: 'bg-yellow-400' },
];

export const CATEGORY_ORDER = CATEGORIES.map(c => c.id);

export const SKILLS: SkillInfo[] = [
  // ── Mining ────────────────────────────────────────────────
  { id: 'mining',                    category: 'mining',      name: 'Mining',                    description: 'Ore extraction basics. Increases yield by 5% per level.' },
  { id: 'advanced_mining',           category: 'mining',      name: 'Advanced Mining',           description: 'Expert extraction. Unlocks rare ore mining.' },
  { id: 'advanced_refinement',       category: 'mining',      name: 'Advanced Refinement',       description: 'Extract maximum yield from ores. Reduce waste.' },
  { id: 'deep_core_mining',          category: 'mining',      name: 'Deep Core Mining',          description: 'Extract materials from planetary cores and dense asteroids.' },
  { id: 'gas_harvesting',            category: 'mining',      name: 'Gas Harvesting',            description: 'Collect gases from nebulae and gas clouds. Exotic materials.' },
  { id: 'gas_processing',            category: 'mining',      name: 'Gas Processing',            description: 'Refine harvested gases into fuels and chemicals.' },
  { id: 'ice_mining',                category: 'mining',      name: 'Ice Mining',                description: 'Extraction of ice and frozen compounds. Fuel and water source.' },
  { id: 'ice_refining',              category: 'mining',      name: 'Ice Refining',              description: 'Process ice into water, oxygen, and hydrogen fuel.' },
  { id: 'ore_refinement',            category: 'mining',      name: 'Ore Refinement',            description: 'Processing expertise. Increases refining output.' },
  { id: 'radioactive_handling',      category: 'mining',      name: 'Radioactive Handling',      description: 'Safe extraction and processing of radioactive materials.' },

  // ── Ships ─────────────────────────────────────────────────
  { id: 'small_ships',               category: 'ships',       name: 'Small Ships',               description: 'Frigates and destroyers. Improved handling of small craft.' },
  { id: 'medium_ships',              category: 'ships',       name: 'Medium Ships',              description: 'Cruisers and battlecruisers. Required for medium hulls.' },
  { id: 'large_ships',               category: 'ships',       name: 'Large Ships',               description: 'Battleships and large hulls. Heavy combat vessels.' },
  { id: 'capital_ships',             category: 'ships',       name: 'Capital Ships',             description: 'Heavy ship operation. Required for battleships and carriers.' },
  { id: 'industrial_ships',          category: 'ships',       name: 'Industrial Ships',          description: 'Mining barges and haulers. Industrial vessel operation.' },
  { id: 'covert_operations',         category: 'ships',       name: 'Covert Operations',         description: 'Stealth ships. Required for covert ops vessels.' },
  { id: 'fleet_command',             category: 'ships',       name: 'Fleet Command',             description: 'Command carrier operations. Bonuses to fleet coordination.' },

  // ── Navigation ────────────────────────────────────────────
  { id: 'navigation',                category: 'navigation',  name: 'Navigation',                description: 'Astrogation expertise. Reduces travel time by 5% per level.' },
  { id: 'fuel_efficiency',           category: 'navigation',  name: 'Fuel Efficiency',           description: 'Engine optimization. Reduces fuel consumption by 3% per level.' },
  { id: 'jump_calibration',          category: 'navigation',  name: 'Jump Calibration',          description: 'Precision hyperspace calculations. Jump to more distant systems.' },
  { id: 'jump_drive_operation',      category: 'navigation',  name: 'Jump Drive Operation',      description: 'Hyperspace expertise. Reduces jump time and fuel cost.' },
  { id: 'warp_efficiency',           category: 'navigation',  name: 'Warp Efficiency',           description: 'Sub-light engine mastery. Faster in-system travel.' },

  // ── Engineering ───────────────────────────────────────────
  { id: 'engineering',               category: 'engineering', name: 'Engineering',               description: 'Ship systems management. Improves power and CPU efficiency.' },
  { id: 'advanced_engineering',      category: 'engineering', name: 'Advanced Engineering',      description: 'Expert systems optimization. Unlocks overclocking.' },
  { id: 'capacitor_systems',         category: 'engineering', name: 'Capacitor Systems',         description: 'Energy storage management. Faster capacitor recharge.' },
  { id: 'cpu_management',            category: 'engineering', name: 'CPU Management',            description: 'Optimize ship computer. More complex fittings.' },
  { id: 'damage_control',            category: 'engineering', name: 'Damage Control',            description: 'Emergency repairs. Reduces hull damage taken.' },
  { id: 'power_grid_management',     category: 'engineering', name: 'Power Grid Management',     description: 'Optimize power consumption. Reduces module power usage by 2% per level.' },
  { id: 'repair_systems',            category: 'engineering', name: 'Repair Systems',            description: 'Field repairs. Enables hull regeneration in space.' },
  { id: 'rigging',                   category: 'engineering', name: 'Rigging',                   description: 'Install ship rigs. Permanent ship modifications.' },

  // ── Crafting ──────────────────────────────────────────────
  { id: 'basic_crafting',            category: 'crafting',    name: 'Basic Crafting',            description: 'Fundamental manufacturing. Craft basic items.' },
  { id: 'advanced_crafting',         category: 'crafting',    name: 'Advanced Crafting',         description: 'Expert manufacturing. Craft advanced components.' },
  { id: 'biological_processing',     category: 'crafting',    name: 'Biological Processing',     description: 'Culture and process biological materials for industrial and pharmaceutical use.' },
  { id: 'blueprint_research',        category: 'crafting',    name: 'Blueprint Research',        description: 'Improve blueprints through research. Reduce material costs.' },
  { id: 'crafting_mastery',          category: 'crafting',    name: 'Crafting Mastery',          description: 'Master craftsman. Create exceptional quality items.' },
  { id: 'electronics_crafting',      category: 'crafting',    name: 'Electronics Crafting',      description: 'Create electronic components and modules.' },
  { id: 'mass_production',           category: 'crafting',    name: 'Mass Production',           description: 'Efficient large-scale manufacturing. Reduced time and costs.' },
  { id: 'module_crafting',           category: 'crafting',    name: 'Module Crafting',           description: 'Create ship modules and upgrades.' },
  { id: 'quality_control',           category: 'crafting',    name: 'Quality Control',           description: 'Rigorous testing and inspection. Higher average item quality.' },
  { id: 'shield_crafting',           category: 'crafting',    name: 'Shield Crafting',           description: 'Defense manufacturing. Create shield components.' },
  { id: 'ship_construction',         category: 'crafting',    name: 'Ship Construction',         description: 'Shipwright skills. Build and modify ships.' },
  { id: 'weapon_crafting',           category: 'crafting',    name: 'Weapon Crafting',           description: 'Arms manufacturing. Create weapons and ammunition.' },

  // ── Trading ───────────────────────────────────────────────
  { id: 'trading',                   category: 'trading',     name: 'Trading',                   description: 'Market knowledge. Better buy/sell prices.' },
  { id: 'auction_mastery',           category: 'trading',     name: 'Auction Mastery',           description: 'Expert in market auctions. Reduced fees and better timing.' },
  { id: 'black_market_trading',      category: 'trading',     name: 'Black Market Trading',      description: 'Access to underground markets. Buy and sell contraband at better rates.' },
  { id: 'bulk_trading',              category: 'trading',     name: 'Bulk Trading',              description: 'Large volume transactions. Better prices for big orders.' },
  { id: 'contracts',                 category: 'trading',     name: 'Contracts',                 description: 'Mission and contract expertise. Better mission rewards.' },
  { id: 'hauling',                   category: 'trading',     name: 'Hauling',                   description: 'Cargo management expertise. Increase effective cargo capacity.' },
  { id: 'insurance_brokering',       category: 'trading',     name: 'Insurance Brokering',       description: 'Expert in ship insurance. Better rates and faster claims.' },
  { id: 'loan_management',           category: 'trading',     name: 'Loan Management',           description: 'Financial expertise. Better loan terms and credit limits.' },
  { id: 'negotiation',               category: 'trading',     name: 'Negotiation',               description: 'Deal-making expertise. Additional price improvements.' },
  { id: 'rare_goods_expertise',      category: 'trading',     name: 'Rare Goods Expertise',      description: 'Knowledge of exotic and valuable items. Better appraisal and prices.' },
  { id: 'smuggling',                 category: 'trading',     name: 'Smuggling',                 description: 'Contraband expertise. Evade scans and transport illegal goods.' },

  // ── Combat ────────────────────────────────────────────────
  { id: 'basic_weapons',             category: 'combat',      name: 'Basic Weapons',             description: 'Fundamental weapon operation. Increases damage by 2% per level.' },
  { id: 'advanced_weapons',          category: 'combat',      name: 'Advanced Weapons',          description: 'Expert weapon systems. Increases damage by 3% per level.' },
  { id: 'advanced_armor',            category: 'combat',      name: 'Advanced Armor',            description: 'Expert armor plating. Improves damage mitigation.' },
  { id: 'advanced_shields',          category: 'combat',      name: 'Advanced Shields',          description: 'Expert shield optimization. Improves recharge and resistance.' },
  { id: 'anti_drone_warfare',        category: 'combat',      name: 'Anti-Drone Warfare',        description: 'Specialized tactics against drone swarms. Increased damage to drones.' },
  { id: 'armor_hardening',           category: 'combat',      name: 'Armor Hardening',           description: 'Hull reinforcement. Increases armor effectiveness by 3% per level.' },
  { id: 'boarding_combat',           category: 'combat',      name: 'Boarding Combat',           description: 'Ship-to-ship boarding operations. Capture enemy vessels.' },
  { id: 'bounty_hunting',            category: 'combat',      name: 'Bounty Hunting',            description: 'Lawful pursuit. Bonuses to tracking and bounty rewards.' },
  { id: 'capital_weapon_systems',    category: 'combat',      name: 'Capital Weapon Systems',    description: 'Operation of doomsday devices and siege weapons. Massive damage.' },
  { id: 'combat_maneuvering',        category: 'combat',      name: 'Combat Maneuvering',        description: 'High-speed combat piloting. Improved agility in battle.' },
  { id: 'ecm_resistance',            category: 'combat',      name: 'ECM Resistance',            description: 'Hardened systems. Reduces effectiveness of enemy jamming.' },
  { id: 'electronic_warfare',        category: 'combat',      name: 'Electronic Warfare',        description: 'Jamming and countermeasures. Disrupts enemy targeting.' },
  { id: 'energy_weapons',            category: 'combat',      name: 'Energy Weapons',            description: 'Laser and plasma weapon specialization. Increases energy weapon damage.' },
  { id: 'evasive_maneuvers',         category: 'combat',      name: 'Evasive Maneuvers',         description: 'Defensive piloting. Chance to avoid incoming attacks.' },
  { id: 'gravity_manipulation',      category: 'combat',      name: 'Gravity Manipulation',      description: 'Control over gravitational forces. Required for graviton beam weapons.' },
  { id: 'ion_weapons',               category: 'combat',      name: 'Ion Weapons',               description: 'Disabling ion technology. Drains capacitor and disrupts systems.' },
  { id: 'kinetic_weapons',           category: 'combat',      name: 'Kinetic Weapons',           description: 'Projectile and railgun specialization. Increases kinetic weapon damage.' },
  { id: 'missile_systems',           category: 'combat',      name: 'Missile Systems',           description: 'Guided missile and torpedo operation. Increases explosive damage.' },
  { id: 'piracy',                    category: 'combat',      name: 'Piracy',                    description: 'Outlaw expertise. Bonuses to looting and escape.' },
  { id: 'plasma_weapons',            category: 'combat',      name: 'Plasma Weapons',            description: 'Superheated plasma weapon mastery. High damage vs shields.' },
  { id: 'point_defense_systems',     category: 'combat',      name: 'Point Defense Systems',     description: 'Automated missile and drone interception.' },
  { id: 'shield_hardening',          category: 'combat',      name: 'Shield Hardening',          description: 'Damage-specific shield resistance. Reduces incoming damage types.' },
  { id: 'shield_operation',          category: 'combat',      name: 'Shield Operation',          description: 'Shield system management. Increases capacity by 5% per level.' },
  { id: 'siege_warfare',             category: 'combat',      name: 'Siege Warfare',             description: 'Station and structure assault tactics. Bonus damage to stationary targets.' },
  { id: 'target_painting',           category: 'combat',      name: 'Target Painting',           description: 'Mark targets for increased damage. Team combat support.' },
  { id: 'targeting_systems',         category: 'combat',      name: 'Targeting Systems',         description: 'Precision targeting. Increases accuracy and optimal range.' },
  { id: 'void_manipulation',         category: 'combat',      name: 'Void Manipulation',         description: 'Mastery of void energy. Required for void lances and entropy beams.' },
  { id: 'weapons_mastery',           category: 'combat',      name: 'Weapons Mastery',           description: 'Master weaponeer. Unlocks elite weapons and techniques.' },

  // ── Drones ────────────────────────────────────────────────
  { id: 'drone_operation',           category: 'drones',      name: 'Drone Operation',           description: 'Basic drone control. Increases drone damage.' },
  { id: 'combat_drones',             category: 'drones',      name: 'Combat Drones',             description: 'Specialize in attack drones. Increased damage.' },
  { id: 'drone_control',             category: 'drones',      name: 'Drone Control',             description: 'Advanced drone management. Increases bandwidth.' },
  { id: 'drone_durability',          category: 'drones',      name: 'Drone Durability',          description: 'Hardened drones. Increases drone hit points.' },
  { id: 'drone_interfacing',         category: 'drones',      name: 'Drone Interfacing',         description: 'Neural drone link. Massively improved drone performance.' },
  { id: 'mining_drones',             category: 'drones',      name: 'Mining Drones',             description: 'Specialize in mining drones. Increased yield.' },
  { id: 'repair_drones',             category: 'drones',      name: 'Repair Drones',             description: 'Specialize in repair drones. Field maintenance.' },
  { id: 'salvage_drones',            category: 'drones',      name: 'Salvage Drones',            description: 'Automated salvage operations. Drone-assisted looting.' },

  // ── Exploration ───────────────────────────────────────────
  { id: 'exploration',               category: 'exploration', name: 'Exploration',               description: 'Space exploration expertise. Bonus XP from visiting new systems.' },
  { id: 'anomaly_detection',         category: 'exploration', name: 'Anomaly Detection',         description: 'Find cosmic anomalies. Rare exploration sites.' },
  { id: 'anomaly_exploitation',      category: 'exploration', name: 'Anomaly Exploitation',      description: 'Extract resources and data from cosmic anomalies.' },
  { id: 'astrometrics',              category: 'exploration', name: 'Astrometrics',              description: 'Star mapping and system analysis. Higher levels reveal more system detail.' },
  { id: 'cartography',               category: 'exploration', name: 'Cartography',               description: 'Create detailed maps. Sell exploration data.' },
  { id: 'environmental_hazard_resistance', category: 'exploration', name: 'Environmental Hazard Resistance', description: 'Survive hostile space environments. Reduced damage from hazards.' },
  { id: 'first_contact_protocols',   category: 'exploration', name: 'First Contact Protocols',   description: 'Handle encounters with unknown entities and factions.' },
  { id: 'survey',                    category: 'exploration', name: 'Survey',                    description: 'Detailed resource surveys. Find hidden deposits.' },
  { id: 'wormhole_navigation',       category: 'exploration', name: 'Wormhole Navigation',       description: 'Navigate unstable wormholes. Access hidden systems.' },

  // ── Support ───────────────────────────────────────────────
  { id: 'scanning',                  category: 'support',     name: 'Scanning',                  description: 'Sensor operation. Improved scanner effectiveness.' },
  { id: 'advanced_scanning',         category: 'support',     name: 'Advanced Scanning',         description: 'Deep scans and signature analysis. Reveal hidden information.' },
  { id: 'advanced_cloaking',         category: 'support',     name: 'Advanced Cloaking',         description: 'Move while cloaked. Extended stealth duration.' },
  { id: 'alliance_management',       category: 'support',     name: 'Alliance Management',       description: 'Coordinate multi-faction alliances. Diplomatic bonuses.' },
  { id: 'cloaking',                  category: 'support',     name: 'Cloaking',                  description: 'Stealth systems. Improved cloak effectiveness.' },
  { id: 'counter_hacking',           category: 'support',     name: 'Counter-Hacking',           description: 'System defense. Resist hacking attempts.' },
  { id: 'counter_intelligence',      category: 'support',     name: 'Counter-Intelligence',      description: 'Detect and neutralize enemy spies. Protect faction secrets.' },
  { id: 'diplomacy',                 category: 'support',     name: 'Diplomacy',                 description: 'Political acumen. Better faction relations.' },
  { id: 'espionage',                 category: 'support',     name: 'Espionage',                 description: 'Covert intelligence gathering. Spy on enemy factions.' },
  { id: 'fleet_coordination',        category: 'support',     name: 'Fleet Coordination',        description: 'Coordinate large fleet operations. Share bonuses.' },
  { id: 'hacking',                   category: 'support',     name: 'Hacking',                   description: 'Computer intrusion. Access secured systems.' },
  { id: 'leadership',                category: 'support',     name: 'Leadership',                description: 'Command skills. Bonuses for faction fleet members.' },
  { id: 'mentoring',                 category: 'support',     name: 'Mentoring',                 description: 'Guide new players. Bonuses for both mentor and student.' },
  { id: 'propaganda',                category: 'support',     name: 'Propaganda',                description: 'Information warfare. Influence public opinion and morale.' },
  { id: 'reputation_management',     category: 'support',     name: 'Reputation Management',     description: 'Control your public image. Faster reputation recovery.' },

  // ── Salvaging ─────────────────────────────────────────────
  { id: 'salvaging',                 category: 'salvaging',   name: 'Salvaging',                 description: 'Extract materials from ship wrecks. Basic recovery.' },
  { id: 'advanced_salvaging',        category: 'salvaging',   name: 'Advanced Salvaging',        description: 'Expert wreck processing. Recover intact modules.' },
  { id: 'archaeology',               category: 'salvaging',   name: 'Archaeology',               description: 'Relic hunting. Increases chance of finding artifacts.' },
  { id: 'relic_identification',      category: 'salvaging',   name: 'Relic Identification',      description: 'Expertise in ancient artifacts. Determines true value and function.' },

  // ── Faction ───────────────────────────────────────────────
  { id: 'corporation_management',    category: 'faction',     name: 'Corporation Management',    description: 'Lead player factions. Increased member limits.' },
  { id: 'faction_warfare',           category: 'faction',     name: 'Faction Warfare',           description: 'Empire militia combat. Improved rewards in faction conflicts.' },
  { id: 'station_management',        category: 'faction',     name: 'Station Management',        description: 'Operate player-owned stations. Efficiency bonuses.' },

  // ── Empire ────────────────────────────────────────────────
  { id: 'crimson_bloodlust',         category: 'empire',      name: 'Crimson Bloodlust',         description: 'The more you destroy, the stronger you become. Kill streaks grant bonuses.' },
  { id: 'crimson_fury',              category: 'empire',      name: 'Crimson Fury',              description: 'Embrace the berserker rage of the Crimson Fleet. Increased damage when damaged.' },
  { id: 'nebula_attunement',         category: 'empire',      name: 'Nebula Attunement',         description: 'Harmonize with cosmic energies of the Nebula Federation. Enhanced gas harvesting.' },
  { id: 'nebula_communion',          category: 'empire',      name: 'Nebula Communion',          description: 'Deep connection with the collective consciousness. Telepathic fleet bonuses.' },
  { id: 'outer_rim_scavenger',       category: 'empire',      name: 'Outer Rim Scavenger',       description: 'Make the most of every wreck and abandoned site. Enhanced salvaging.' },
  { id: 'outer_rim_survival',        category: 'empire',      name: 'Outer Rim Survival',        description: 'Hardened by the lawless frontier. Improved self-reliance and repair.' },
  { id: 'solarian_discipline',       category: 'empire',      name: 'Solarian Discipline',       description: 'Military precision of the Solarian Empire. Improved accuracy and fleet coordination.' },
  { id: 'solarian_doctrine',         category: 'empire',      name: 'Solarian Doctrine',         description: 'Advanced Solarian naval tactics. Bonus to shield regeneration and armor repair.' },
  { id: 'voidborn_entropy',          category: 'empire',      name: 'Voidborn Entropy',          description: "Channel the void's destructive energy. Bonus to energy weapon damage and capacitor drain." },
  { id: 'voidborn_phase_mastery',    category: 'empire',      name: 'Voidborn Phase Mastery',    description: 'Harness phase technology of the Voidborn. Improved cloaking and dimensional abilities.' },

  // ── Prestige ──────────────────────────────────────────────
  { id: 'drone_sovereign',           category: 'prestige',    name: 'Drone Sovereign',           description: 'Command vast drone fleets with neural precision. Ultimate drone mastery.' },
  { id: 'grand_admiral',             category: 'prestige',    name: 'Grand Admiral',             description: 'Supreme fleet commander. Massive fleet bonuses and tactical options.' },
  { id: 'industrial_magnate',        category: 'prestige',    name: 'Industrial Magnate',        description: 'Baron of industry and mining. Massive extraction and production bonuses.' },
  { id: 'legendary_pilot',           category: 'prestige',    name: 'Legendary Pilot',           description: 'Recognized across the galaxy as an elite pilot. Universal combat bonuses.' },
  { id: 'master_craftsman',          category: 'prestige',    name: 'Master Craftsman',          description: 'Legendary artisan. Create items of unmatched quality.' },
  { id: 'master_trader',             category: 'prestige',    name: 'Master Trader',             description: 'Economic genius with galactic influence. Maximum trading efficiency.' },
  { id: 'pathfinder',                category: 'prestige',    name: 'Pathfinder',                description: 'Legendary explorer who has charted the unknown reaches. Discovery bonuses.' },
  { id: 'shadow_operative',          category: 'prestige',    name: 'Shadow Operative',          description: 'Master of covert operations. Ultimate stealth and espionage capabilities.' },
  { id: 'titan_pilot',               category: 'prestige',    name: 'Titan Pilot',               description: 'Certified to command the largest capital ships. Required for titans.' },
  { id: 'warlord',                   category: 'prestige',    name: 'Warlord',                   description: 'Feared conqueror of systems. Massive combat and intimidation bonuses.' },
];

/** Lookup map: skill_id → SkillInfo */
export const SKILL_MAP = new Map<string, SkillInfo>(SKILLS.map(s => [s.id, s]));

/** Lookup map: skill_id → category id */
export const SKILL_CATEGORY_MAP: Record<string, string> = Object.fromEntries(
  SKILLS.map(s => [s.id, s.category])
);

/** Group skills by category, in CATEGORY_ORDER. */
export function groupSkillsByCategory(
  skillEntries: Array<{ skill_id: string; level: number; xp?: number; xp_to_next?: number }>
): Array<{ category: CategoryInfo; skills: Array<{ info: SkillInfo; entry: typeof skillEntries[0] }> }> {
  const byCategory = new Map<string, Array<{ info: SkillInfo; entry: typeof skillEntries[0] }>>();

  for (const entry of skillEntries) {
    const info = SKILL_MAP.get(entry.skill_id);
    if (!info) continue;
    const cat = info.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push({ info, entry });
  }

  const result: Array<{ category: CategoryInfo; skills: Array<{ info: SkillInfo; entry: typeof skillEntries[0] }> }> = [];
  for (const catId of CATEGORY_ORDER) {
    const sks = byCategory.get(catId);
    if (!sks || sks.length === 0) continue;
    const catInfo = CATEGORIES.find(c => c.id === catId)!;
    result.push({ category: catInfo, skills: sks });
  }
  return result;
}

/** Compute average skill level per category (for radar chart). */
export function categoryRadarData(
  skillEntries: Array<{ skill_id: string; level: number }>
): Array<{ category: CategoryInfo; avgLevel: number; maxLevel: number }> {
  const byCategory = new Map<string, number[]>();
  for (const entry of skillEntries) {
    const info = SKILL_MAP.get(entry.skill_id);
    if (!info) continue;
    if (!byCategory.has(info.category)) byCategory.set(info.category, []);
    byCategory.get(info.category)!.push(entry.level ?? 0);
  }

  return CATEGORIES.map(cat => {
    const levels = byCategory.get(cat.id) ?? [];
    const avg = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
    const max = levels.length > 0 ? Math.max(...levels) : 0;
    return { category: cat, avgLevel: Math.round(avg * 10) / 10, maxLevel: max };
  }).filter(d => d.avgLevel > 0 || d.maxLevel > 0);
}
