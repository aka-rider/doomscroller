import { createSignal, Show, For } from 'solid-js';
import type { Tag } from '../lib/api';
import { TagPreferenceGrid } from './TagPreferenceGrid';

interface OnboardingProps {
  tags: Tag[];
  onComplete: (preferences: Map<number, string>) => void;
}

export const Onboarding = (props: OnboardingProps) => {
  const [step, setStep] = createSignal(0);
  const [preferences, setPreferences] = createSignal(new Map<number, string>());

  const handleToggle = (tagId: number, mode: string) => {
    setPreferences((prev) => {
      const next = new Map(prev);
      if (mode === 'none') {
        next.delete(tagId);
      } else {
        next.set(tagId, mode);
      }
      return next;
    });
  };

  const handleComplete = () => {
    props.onComplete(preferences());
  };

  return (
    <div class="onboarding">
      <div class="onboarding-content">
        {/* Step indicator dots */}
        <div class="onboarding-step-dots">
          <For each={[0, 1, 2]}>
            {(i) => (
              <div class={`onboarding-dot ${step() === i ? 'active' : ''}`} />
            )}
          </For>
        </div>

        {/* Step 1: Welcome */}
        <Show when={step() === 0}>
          <h1 style={{
            "font-family": "var(--font-serif)",
            "font-size": "var(--text-4xl)",
            "font-weight": "700",
            "margin-bottom": "var(--space-4)",
          }}>
            Welcome to Doomscroller
          </h1>
          <p style={{
            "font-family": "var(--font-serif)",
            "font-size": "var(--text-lg)",
            color: "var(--text-secondary)",
            "margin-bottom": "var(--space-8)",
          }}>
            Your personal, AI-powered RSS reader. Tell us what you care about.
          </p>
          <div class="onboarding-nav" style={{ "justify-content": "center" }}>
            <button class="btn btn-primary" onClick={() => setStep(1)}>Next</button>
          </div>
        </Show>

        {/* Step 2: Tag preferences */}
        <Show when={step() === 1}>
          <h2 style={{
            "font-family": "var(--font-serif)",
            "font-size": "var(--text-3xl)",
            "margin-bottom": "var(--space-2)",
          }}>
            What interests you?
          </h2>
          <p style={{
            color: "var(--text-secondary)",
            "margin-bottom": "var(--space-6)",
          }}>
            Star topics you love. Cross out topics you don't. Skip the rest.
          </p>
          <TagPreferenceGrid
            tags={props.tags}
            preferences={preferences()}
            onToggle={handleToggle}
          />
          <div class="onboarding-nav">
            <button class="btn" onClick={() => setStep(0)}>Back</button>
            <button class="btn btn-primary" onClick={() => setStep(2)}>Next</button>
          </div>
        </Show>

        {/* Step 3: Ready */}
        <Show when={step() === 2}>
          <h2 style={{
            "font-family": "var(--font-serif)",
            "font-size": "var(--text-3xl)",
            "margin-bottom": "var(--space-2)",
          }}>
            You're all set!
          </h2>
          <p style={{
            color: "var(--text-secondary)",
            "margin-bottom": "var(--space-8)",
          }}>
            Your feeds are being fetched. Hit the button to start reading.
          </p>
          <div class="onboarding-nav">
            <button class="btn" onClick={() => setStep(1)}>Back</button>
            <button class="btn btn-primary" onClick={handleComplete}>Start Reading</button>
          </div>
        </Show>
      </div>
    </div>
  );
};
