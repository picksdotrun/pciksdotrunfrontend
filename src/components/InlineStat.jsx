export default function InlineStat({ label, value, helper, onClick }) {
  const clickable = typeof onClick === 'function'
  const Component = clickable ? 'button' : 'div'

  return (
    <Component
      type={clickable ? 'button' : undefined}
      onClick={onClick}
      className={`flex flex-col text-left gap-1 text-xs text-gray-secondary ${clickable ? 'hover:text-white transition-colors' : ''}`}
    >
      <span className="uppercase tracking-[0.3em] text-[10px]">{label}</span>
      <span className="text-lg font-semibold text-white">{value}</span>
      {helper ? <span className="text-[11px] text-gray-500">{helper}</span> : null}
    </Component>
  )
}
