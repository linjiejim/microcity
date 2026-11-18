import type { Look } from '@microcity/society';

/** 头像：圆形小像，肤色、发色、衣服来自内核给的长相 */
export function Avatar({ look, size = 32 }: { look: Look; size?: number }) {
  const long = look.hairStyle === 'long' || look.hairStyle === 'ponytail' || look.hairStyle === 'bob';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ flex: 'none', borderRadius: '50%', background: 'var(--surface-2)' }} aria-hidden>
      <path d="M4 34c0-7 5-11 12-11s12 4 12 11z" fill={look.top} />
      {long && <path d="M8.6 14c0-6 3-9 7.4-9s7.4 3 7.4 9v6.5h-3V14h-8.800v6.5h-3z" fill={look.hair} />}
      <circle cx="16" cy="14" r="6.2" fill={look.skin} />
      {look.hairStyle !== 'bald' && <path d="M9.6 13.2c0-4.600 2.800-7 6.400-7s6.400 2.400 6.400 7c-1.600-2.600-3.600-3.600-6.400-3.600s-4.800 1-6.400 3.600z" fill={look.hair} />}
      {look.hairStyle === 'bun' && <circle cx="16" cy="6.200" r="2.400" fill={look.hair} />}
      {look.hairStyle === 'cap' && <path d="M9.400 11.800c.600-4 3.200-5.800 6.600-5.800s6 1.800 6.600 5.800l3 .8v1.200H9.400z" fill="#3f5f7a" />}
      {look.accent === 'hat' && <path d="M8.400 11.400h15.200l-1.600-4.200c-1.400-1.400-3.400-2-6-2s-4.600.6-6 2z" fill="#8f7f6f" />}
      {look.accent === 'glasses' && <path d="M11 14.200h4m2 0h4m-6 0h2" stroke="#26241f" strokeWidth="1" fill="none" />}
      {look.accent === 'scarf' && <path d="M10.500 20.500c3 1.800 8 1.800 11 0v2.200c-3 1.800-8 1.800-11 0z" fill="#c2553a" />}
      {look.accent === 'apron' && <path d="M12.500 25h7v9h-7z" fill="#f3eee6" />}
    </svg>
  );
}
