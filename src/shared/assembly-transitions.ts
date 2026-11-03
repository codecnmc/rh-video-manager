import type { AssemblyTransitionKind } from './contracts/assembly-effects'

interface TransitionDefinition {
  label: string; overlap: boolean; purpose: string; expression?: string
}

// 只有实现了预览及导出的效果才进入能力清单；表达式均为内置常量，不接受外部注入。
export const assemblyTransitions: Record<AssemblyTransitionKind, TransitionDefinition> = {
  dissolve: { label: '交叉叠化', overlap: true, purpose: '时间流逝、回忆；动作接续优先硬切', expression: 'A*P+B*(1-P)' },
  black: { label: '淡出淡入黑场', overlap: false, purpose: '段落结束、插卡前后停顿' },
  white: { label: '淡出淡入白场', overlap: false, purpose: '主观闪回、梦境变化，克制使用' },
  'wipe-left': { label: '向左擦除', overlap: true, purpose: '风格化章节衔接', expression: 'if(gte(X/W,P),B,A)' },
  'wipe-right': { label: '向右擦除', overlap: true, purpose: '风格化章节衔接', expression: 'if(lte(X/W,1-P),B,A)' },
  'wipe-up': { label: '向上擦除', overlap: true, purpose: '风格化章节衔接', expression: 'if(gte(Y/H,P),B,A)' },
  'wipe-down': { label: '向下擦除', overlap: true, purpose: '风格化章节衔接', expression: 'if(lte(Y/H,1-P),B,A)' },
  'iris-open': { label: '虹膜打开', overlap: true, purpose: '默片开场、梦境或主观视点', expression: 'if(lte(hypot((X-W/2)/W,(Y-H/2)/H),sqrt(0.5)*(1-P)),B,A)' },
  'iris-close': { label: '虹膜收拢', overlap: true, purpose: '默片段落收束、梦境回环', expression: 'if(lte(hypot((X-W/2)/W,(Y-H/2)/H),sqrt(0.5)*P),A,B)' }
}

export function isOverlappingTransition(kind: AssemblyTransitionKind | undefined): boolean {
  return kind !== undefined && assemblyTransitions[kind].overlap
}

export function transitionClipPath(kind: AssemblyTransitionKind, progress: number, outgoing = false): string | undefined {
  const p = Math.max(0, Math.min(1, progress))
  if (outgoing) return kind === 'iris-close' ? `ellipse(${Math.SQRT1_2 * (1 - p) * 100}% ${Math.SQRT1_2 * (1 - p) * 100}% at 50% 50%)` : undefined
  const hidden = (1 - p) * 100
  switch (kind) {
    case 'wipe-left': return `inset(0 0 0 ${hidden}%)`
    case 'wipe-right': return `inset(0 ${hidden}% 0 0)`
    case 'wipe-up': return `inset(${hidden}% 0 0 0)`
    case 'wipe-down': return `inset(0 0 ${hidden}% 0)`
    // 椭圆归一化到画布宽高，和导出的 X/W、Y/H 距离保持一致。
    case 'iris-open': return `ellipse(${Math.SQRT1_2 * p * 100}% ${Math.SQRT1_2 * p * 100}% at 50% 50%)`
    default: return undefined
  }
}
