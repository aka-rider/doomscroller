interface TagPillProps {
  slug: string;
  label: string;
  tagId?: number;
  mode: 'none' | 'whitelist' | 'blacklist';
  onClick: (slug: string) => void;
  onCyclePreference?: (tagId: number, newMode: 'none' | 'whitelist' | 'blacklist') => void;
}

const NEXT_MODE: Record<string, 'none' | 'whitelist' | 'blacklist'> = {
  none: 'whitelist',
  whitelist: 'blacklist',
  blacklist: 'none',
};

const MODE_PREFIX: Record<string, string> = {
  whitelist: '\u2713 ',
  blacklist: '\u2717 ',
  none: '',
};

export const TagPill = (props: TagPillProps) => {
  const modeClass = () => {
    switch (props.mode) {
      case 'whitelist': return 'tag-pill--whitelist';
      case 'blacklist': return 'tag-pill--blacklist';
      default: return '';
    }
  };

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (props.onCyclePreference && props.tagId != null) {
      const next = NEXT_MODE[props.mode] ?? 'none';
      props.onCyclePreference(props.tagId, next);
    } else {
      props.onClick(props.slug);
    }
  };

  return (
    <button
      class="tag-pill"
      classList={{ [modeClass()]: !!modeClass() }}
      onClick={handleClick}
    >
      {MODE_PREFIX[props.mode] ?? ''}{props.label}
    </button>
  );
};
