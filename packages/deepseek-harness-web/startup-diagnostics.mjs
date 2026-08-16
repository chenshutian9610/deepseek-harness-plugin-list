function errorText(value) {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  return String(value)
}

function renderNested(value, indent, seen) {
  if (value instanceof Error && seen.has(value)) return [`${indent}[circular error reference]`]
  if (value instanceof Error) seen.add(value)

  const lines = errorText(value).split('\n').map(line => `${indent}${line}`)
  if (value instanceof AggregateError) {
    value.errors.forEach((member, index) => {
      lines.push(`${indent}Aggregate member ${index + 1}:`)
      lines.push(...renderNested(member, `${indent}  `, seen))
    })
  }
  if (value instanceof Error && value.cause !== undefined) {
    lines.push(`${indent}Caused by:`)
    lines.push(...renderNested(value.cause, `${indent}  `, seen))
  }
  return lines
}

export function renderStartupError(error) {
  return renderNested(error, '', new Set()).join('\n')
}
