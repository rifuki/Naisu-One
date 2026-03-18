type ProtocolId = 'marinade' | 'marginfi';

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
  
  if (id === 'marginfi') {
    return (
      <div className="w-10 h-10 rounded-full bg-orange-400/20 flex items-center justify-center shrink-0">
        <span className="text-base font-bold text-orange-400">f</span>
      </div>
    );
  }
  
  return (
    <div className="w-10 h-10 rounded-full bg-purple-400/20 flex items-center justify-center shrink-0">
      <span className="text-base font-bold text-purple-400">◎</span>
    </div>
  );
}
