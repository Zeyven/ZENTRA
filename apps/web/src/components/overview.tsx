'use client';
import { useRef, useState } from 'react';
import { Button } from '@ayra/ui/components';
import { Icon } from '@ayra/ui/icons';
const steps = [
  {
    label: 'Think',
    title: 'Start with a question.',
    body: 'Explore an idea in Chat. Bring your context, ask questions, and find a direction.',
  },
  {
    label: 'Create',
    title: 'Make something useful.',
    body: 'Turn your thinking into a research brief, document, or other usable artifact in Work.',
  },
  {
    label: 'Build',
    title: 'Move from idea to outcome.',
    body: 'Bring software projects into Build. Follow progress, review changes, and stay in control.',
  },
];
export function Overview() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(0);
  const current = steps[step]!;
  return (
    <>
      <Button
        variant="quiet"
        ref={trigger}
        onClick={() => {
          setStep(0);
          dialog.current?.showModal();
        }}
      >
        <Icon name="play" size={18} />
        Watch overview
      </Button>
      <dialog
        ref={dialog}
        className="overview-dialog"
        aria-labelledby="overview-title"
        onClose={() => trigger.current?.focus()}
      >
        <div className="overview-top">
          <span className="eyebrow">Product overview · {step + 1} / 3</span>
          <button
            className="close-button"
            aria-label="Close overview"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        <div aria-live="polite">
          <span className="overview-step">{current.label}</span>
          <h2 id="overview-title">{current.title}</h2>
          <p>{current.body}</p>
        </div>
        <p className="release-note">
          An interactive product introduction. Desktop capabilities are in development.
        </p>
        <div className="overview-actions">
          <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Previous
          </Button>
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)}>
              Next
              <Icon name="arrow" size={17} />
            </Button>
          ) : (
            <Button onClick={() => dialog.current?.close()}>Done</Button>
          )}
        </div>
      </dialog>
    </>
  );
}
