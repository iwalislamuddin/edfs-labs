import { useEffect, useState } from 'react'

interface SliderProps {
  label: string
  symbol: string
  value: number
  unit: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}

const decimals = (step: number) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)))

export function Slider({ label, symbol, value, unit, min, max, step, onChange, hint }: SliderProps) {
  const [text, setText] = useState(value.toFixed(decimals(step)))
  useEffect(() => setText(value.toFixed(decimals(step))), [value, step])
  const commit = () => {
    const v = Number(text.replace(',', '.'))
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
    else setText(value.toFixed(decimals(step)))
  }
  return (
    <label className="slider">
      <span className="slider-head">
        <span>
          {label} <i>{symbol}</i>
        </span>
        <span className="slider-val">
          <input
            value={text}
            inputMode="decimal"
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label={`${label} (${unit})`}
          />
          <small>{unit}</small>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      {hint && <small className="slider-hint">{hint}</small>}
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          className={o.id === value ? 'on' : ''}
          title={o.title}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
