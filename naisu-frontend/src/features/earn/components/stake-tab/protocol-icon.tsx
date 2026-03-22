type ProtocolId = 'marinade' | 'jito' | 'jupsol' | 'kamino';

interface ProtocolIconProps {
  id: ProtocolId;
}

export function ProtocolIcon({ id }: ProtocolIconProps) {
  if (id === 'marinade') {
    return (
      <div className="w-10 h-10 rounded-full bg-blue-400/20 flex items-center justify-center shrink-0">
        <span className="text-base font-bold text-blue-400">m</span>
      </div>
    );
  }

  if (id === 'jito') {
    return (
      <div className="w-10 h-10 rounded-full bg-emerald-400/20 flex items-center justify-center shrink-0">
        <span className="text-base font-bold text-emerald-400">J</span>
      </div>
    );
  }

  if (id === 'jupsol') {
    return (
      <div className="w-10 h-10 rounded-full bg-green-400/20 flex items-center justify-center shrink-0">
        <span className="text-base font-bold text-green-400">♃</span>
      </div>
    );
  }

  if (id === 'kamino') {
    return (
      <div className="w-10 h-10 rounded-full bg-violet-400/20 flex items-center justify-center shrink-0">
        <span className="text-base font-bold text-violet-400">K</span>
      </div>
    );
  }

  return (
    <div className="w-10 h-10 rounded-full bg-purple-400/20 flex items-center justify-center shrink-0">
      <span className="text-base font-bold text-purple-400">◎</span>
    </div>
  );
}
