type Node = { class_type: string; inputs: Record<string, unknown> }

// 只识别在基础模型上叠加武打 LoRA 的双分支开关，不覆盖工作流内其他布尔开关。
export function findCombatSwitches(graph: Record<string, Node>): Node[] {
  const linked = (value: unknown): Node | undefined => Array.isArray(value) && typeof value[0] === 'string' && value[1] === 0 ? graph[value[0]] : undefined
  return Object.values(graph).filter((node) => {
    if (node.class_type !== 'ComfySwitchNode' || typeof node.inputs.switch !== 'boolean') return false
    const base = linked(node.inputs.on_false)
    const combat = linked(node.inputs.on_true)
    const stack = combat && linked(combat.inputs.lora_stack)
    return base?.class_type === 'easy loraStackApply' && combat?.class_type === 'easy loraStackApply'
      && linked(combat.inputs.model) === base && stack?.class_type === 'easy loraStack'
      && Object.entries(stack.inputs).some(([field, value]) => /^lora_\d+_name$/.test(field) && typeof value === 'string' && /H3_(Combat|FightFlow)/i.test(value))
  })
}
