interface TagPillProps {
  slug: string;
  label: string;
  mode: 'none' | 'whitelist' | 'blacklist';
  onClick: (slug: string) => void;
}

export const TagPill = (props: TagPillProps) => {
  const modeClass = () => {
    switch (props.mode) {
      case 'whitelist': return 'tag-pill--whitelist';
      case 'blacklist': return 'tag-pill--blacklist';
      default: return '';
    }
  };

  return (
    <button
      class={`tag-pill ${modeClass()}`}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick(props.slug);
      }}
    >
      {props.label}
    </button>
  );
};
