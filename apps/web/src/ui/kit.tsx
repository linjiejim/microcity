import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Look } from '@microcity/sim';
import { iconPaths, type IconName } from './icons.ts';
import { mix, soft } from '../theme/palette.ts';

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

/** 头像：圆形插画，外貌参数（肤色、发型、衣服、配饰）来自内核，颜色映射到暖色系 */
export function Avatar({ look, size = 28, dim }: { look: Look; size?: number; dim?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const skin = soft(look.skin);
  const hair = soft(look.hair);
  const shirt = soft(look.shirt);
  const bg = mix(shirt, '#ffffff', 0.72);
  const px = size === 24 ? 28 : size;
  const hairShape = (() => {
    switch (look.hairStyle) {
      case 'long':
        return <path d="M6.6 11.2C6.6 7 9 4.8 12 4.8s5.4 2.2 5.4 6.4v6.2h-2.2v-5.6c-.9-1.3-1.8-2-3.2-2.3-1.4.3-2.4 1-3.2 2.3v5.6H6.6z" fill={hair} />;
      case 'bun':
        return (
          <>
            <circle cx="12" cy="4.3" r="2.1" fill={hair} />
            <path d="M6.9 10.6C6.9 7.4 9.1 5.4 12 5.4s5.1 2 5.1 5.2c-1.1-1.5-2.9-2.3-5.1-2.3s-4 .8-5.1 2.3z" fill={hair} />
          </>
        );
      case 'bob':
        return <path d="M6.6 11c0-3.8 2.4-6.2 5.4-6.2s5.4 2.4 5.4 6.2v3.2h-1.8v-3.4c-.9-1.2-2-1.9-3.6-2.1-1.6.2-2.7.9-3.6 2.1v3.4H6.6z" fill={hair} />;
      case 'curly':
        return <path d="M6.8 11.3c-.9-1-.6-2.6.5-3.1-.2-1.5 1-2.7 2.4-2.5.6-1.2 2.3-1.6 3.3-.7 1.2-.6 2.7 0 3 1.3 1.3.3 2 1.7 1.3 2.9.8.7.8 2 0 2.6-1.1-1.6-3-2.5-5.3-2.5s-4.1.9-5.2 2z" fill={hair} />;
      case 'cap':
        return <path d="M6.7 10.2c0-3 2.4-5.2 5.3-5.2s5.3 2.2 5.3 5.2H19v1.1H6.7z" fill={shirt} />;
      case 'ponytail':
        return (
          <>
            <path d="M16.2 8.4c1.8.6 2.6 2.4 2.1 5.1-.5-1.4-1.3-2.3-2.4-2.7z" fill={hair} />
            <path d="M6.9 10.6C6.9 7.4 9.1 5.4 12 5.4s5.1 2 5.1 5.2c-1.1-1.5-2.9-2.3-5.1-2.3s-4 .8-5.1 2.3z" fill={hair} />
          </>
        );
      default:
        return <path d="M7 10.4C7 7.3 9.2 5.4 12 5.4s5 1.9 5 5c-1-1.3-2.7-2-5-2s-4 .7-5 2z" fill={hair} />;
    }
  })();
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: dim ? 0.5 : 1, borderRadius: '50%' }} aria-hidden>
      <defs>
        <clipPath id={`av-${uid}`}>
          <circle cx="12" cy="12" r="12" />
        </clipPath>
      </defs>
      <g clipPath={`url(#av-${uid})`}>
        <rect width="24" height="24" fill={bg} />
        <path d="M3.5 24.5c.8-4.6 4.1-7.2 8.5-7.2s7.7 2.6 8.5 7.2z" fill={shirt} />
        {look.accessory === 'apron' && <path d="M9 18.5h6v6H9z" fill="#f7efe1" />}
        {look.accessory === 'scarf' && <path d="M7.6 17.2c2.8 1.4 6 1.4 8.8 0l.6 1.6c-3.3 1.6-6.7 1.6-10 0z" fill="#d6716a" />}
        <rect x="10.6" y="14.4" width="2.8" height="3.2" rx="1.2" fill={skin} />
        <circle cx="12" cy="11" r="5" fill={skin} />
        {hairShape}
        {look.accessory === 'glasses' && (
          <g fill="none" stroke="#3a3740" strokeWidth="0.7">
            <circle cx="10" cy="11.6" r="1.35" />
            <circle cx="14" cy="11.6" r="1.35" />
            <path d="M11.35 11.6h1.3" />
          </g>
        )}
      </g>
    </svg>
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
