import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { iconPaths, type IconName } from './icons.ts';

/** 线性图标；size 为像素边长（旧的 12 视为 16） */
export function Icon({ name, size = 16, color, title, style, strokeWidth = 1.75 }: { name: IconName; size?: number; color?: string; accent?: string; title?: string; style?: CSSProperties; strokeWidth?: number }) {
  const paths = useMemo(() => iconPaths(name), [name]);
  const px = size === 12 ? 16 : size;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={{ display: 'inline-block', flexShrink: 0, color: color ?? 'currentColor', ...style }}
    >
      {title && <title>{title}</title>}
      {paths.map((p, i) => (p.fill ? <path key={i} d={p.d} fill="currentColor" stroke="none" /> : <path key={i} d={p.d} />))}
    </svg>
  );
}

type BtnProps = {
  children?: ReactNode;
  icon?: IconName;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  on?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  testId?: string;
  style?: CSSProperties;
  type?: 'button' | 'submit';
};

export function Button({ children, icon, variant = 'default', size = 'md', on, disabled, title, onClick, testId, style, type = 'button' }: BtnProps) {
  const cls = ['btn', variant !== 'default' ? variant : '', size === 'sm' ? 'sm' : '', !children ? 'icon' : '', on ? 'on' : ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled} title={title} aria-label={!children ? title : undefined} aria-pressed={on === undefined ? undefined : on} onClick={onClick} data-testid={testId} style={style}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}

export function Panel({ title, icon, extra, children, className = '', bodyStyle, testId }: { title?: ReactNode; icon?: IconName; extra?: ReactNode; children: ReactNode; className?: string; bodyStyle?: CSSProperties; testId?: string }) {
  return (
    <section className={`panel surface ${className}`} data-testid={testId}>
      {title !== undefined && (
        <header className="panel-head">
          {icon && <Icon name={icon} color="var(--ink-3)" />}
          <span>{title}</span>
          <span className="grow" />
          {extra}
        </header>
      )}
      <div className="panel-body" style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, testId }: { tabs: Array<{ id: T; label: string; icon?: IconName; count?: number }>; value: T; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="tabs" role="tablist" data-testid={testId}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={`tab ${t.id === value ? 'on' : ''}`} onClick={() => onChange(t.id)} data-testid={`tab-${t.id}`}>
          {t.label}
          {t.count !== undefined && <span className="muted num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, color, solid, outline, icon, title, style }: { children?: ReactNode; color?: string; solid?: boolean; outline?: boolean; icon?: IconName; title?: string; style?: CSSProperties }) {
  const cls = ['badge', solid ? 'solid' : '', outline ? 'outline' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} style={{ ...(color ? { ['--bc' as string]: color } : {}), ...style }} title={title}>
      {icon && <Icon name={icon} size={12} strokeWidth={2} style={{ width: 12, height: 12 }} />}
      {children}
    </span>
  );
}

export function Meter({ value, color, tall, title, testId }: { value: number; color?: string; tall?: boolean; title?: string; testId?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={`meter ${tall ? 'tall' : ''}`} title={title} data-testid={testId} role="meter" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${v * 100}%`, ['--m-color' as string]: color ?? 'var(--teal)' }} />
    </div>
  );
}

export function Modal({ title, icon, onClose, children, footer, width = 720, testId }: { title: ReactNode; icon?: IconName; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; testId?: string }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-testid={testId ? `${testId}-backdrop` : undefined}>
      <div className="modal surface" style={{ width }} role="dialog" aria-modal="true" data-testid={testId}>
        <header className="panel-head">
          {icon && <Icon name={icon} color="var(--ink-3)" />}
          <span>{title}</span>
          <span className="grow" />
          <Button icon="cross" size="sm" variant="ghost" title="关闭 (Esc)" onClick={onClose} testId={testId ? `${testId}-close` : undefined} />
        </header>
        <div className="panel-body" style={{ padding: 18 }}>
          {children}
        </div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Check({ checked, onChange, children, testId, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" className="chk" role="checkbox" aria-checked={checked} onClick={() => !disabled && onChange(!checked)} data-testid={testId} disabled={disabled} style={disabled ? { opacity: 0.45 } : undefined}>
      <span className="box">{checked && <Icon name="check" size={13} strokeWidth={2.4} />}</span>
      {children}
    </button>
  );
}

/** 开关：一个布尔设置 */
export function Switch({ checked, onChange, children, testId, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; testId?: string; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className="switch" role="switch" aria-checked={checked} onClick={() => !disabled && onChange(!checked)} data-testid={testId} disabled={disabled} title={title}>
      {children && <span className="switch-label">{children}</span>}
      <span className="track" />
    </button>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, testId }: { options: Array<{ value: T; label: ReactNode; icon?: IconName; title?: string }>; value: T; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="seg" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)} data-testid={testId ? `${testId}-${o.value}` : undefined}>
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 弹层菜单：按钮 + 点击外部关闭；align 决定弹层靠左还是靠右 */
export function Popover({ trigger, children, align = 'right', testId, width }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; testId?: string; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className="popover" style={{ top: 'calc(100% + 8px)', [align]: 0, ...(width ? { width } : {}) }} data-testid={testId}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** 大数字：一个核心量 + 说明 */
export function BigNumber({ value, of, caption, testId }: { value: ReactNode; of?: ReactNode; caption: ReactNode; testId?: string }) {
  return (
    <div className="bignum" data-testid={testId}>
      <div className="bignum-v num">
        <b>{value}</b>
        {of !== undefined && <span> / {of}</span>}
      </div>
      <div className="bignum-c">{caption}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Empty({ icon = 'search', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={24} />
      <div>{children}</div>
    </div>
  );
}

export function SecTitle({ icon, children, extra }: { icon?: IconName; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="sec-title">
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
      {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
    </div>
  );
}
