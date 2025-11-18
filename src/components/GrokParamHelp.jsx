import ParamCard from './ParamCard'

export default function GrokParamHelp() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <ParamCard
        title="messages"
        short="Ordered chat turns: system · user · assistant"
      >
        <p className="mb-2">Each message is {'{ role, content }'}. Use a system message to set tone, persona, rules.</p>
        <pre className="text-xs bg-black/40 p-2 rounded-md overflow-auto">{`[
  { role: 'system', content: 'Be concise.' },
  { role: 'user', content: 'Hello!' }
]`}</pre>
      </ParamCard>

      <ParamCard title="model" short="Which Grok model to use">
        <p className="mb-1">Defaults to your server setting (e.g. grok-beta). Leave blank to use server default.</p>
      </ParamCard>

      <ParamCard title="temperature" short="Randomness: 0 = precise, 1 = creative">
        <ul className="list-disc list-inside">
          <li>0–0.3: factual, repeatable</li>
          <li>0.7: balanced (default)</li>
          <li>0.9–1.2: more imaginative</li>
        </ul>
      </ParamCard>

      <ParamCard title="max_tokens" short="Cap the response length">
        <p>Upper bound on generated tokens. Leave unset for model default.</p>
      </ParamCard>

      <ParamCard title="top_p" short="Nucleus sampling probability cutoff">
        <p className="mb-1">Typical 0.8–1.0. Use as an alternative to temperature.</p>
        <p className="text-xs text-gray-400">Tip: tweak either temp or top_p first, not both.</p>
      </ParamCard>

      <ParamCard title="stop" short="Stop generation when these strings appear">
        <p>String or list of strings (e.g. "\nYou:").</p>
      </ParamCard>

      <ParamCard title="presence_penalty" short="Encourage new topics (−2…2)">
        <p>Positive values reduce repetition across topics.</p>
      </ParamCard>

      <ParamCard title="frequency_penalty" short="Reduce verbatim repeats (−2…2)">
        <p>Positive values penalize repeated tokens.</p>
      </ParamCard>

      <ParamCard title="Tips" short="Quick recipes and safety">
        <ul className="list-disc list-inside">
          <li>Deterministic: temp 0</li>
          <li>Creative: temp 0.9, default top_p</li>
          <li>Style: set clear system message</li>
          <li>Security: never put secrets in messages</li>
        </ul>
      </ParamCard>
    </div>
  )
}
