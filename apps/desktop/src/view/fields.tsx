/**
 * The wizard's form parts: a captioned field, a choice among plates, the problems a field has,
 * and the row of buttons that ends a step.
 *
 * A field shows its problems only once the store says to (`showProblems`), which it does the
 * first time a person tries to leave the step -- a form that opens covered in complaints about
 * fields nobody has typed in yet teaches people to ignore the complaints.
 */

import { type ReactNode, useId } from "react";
import { useT, useWizard } from "./context.ts";
import { problemsOf } from "./rules.ts";
import type { WizardField } from "./wizard.ts";

export function FieldProblems({ field }: { readonly field: WizardField }): ReactNode {
  const t = useT();
  // The state itself, derived from below: a selector answering a new array on every call would
  // never settle, and Zustand 5 refuses such a selector outright.
  const wizard = useWizard((state) => state);
  const problems = problemsOf(wizard).filter((problem) => problem.field === field);
  if (!wizard.showProblems || problems.length === 0) {
    return null;
  }
  return (
    <ul className="problems" role="alert">
      {problems.map((problem) => (
        <li key={problem.code}>
          {t(`problem.${problem.code}`, { field: t(`field.${problem.field}`) })}
        </li>
      ))}
    </ul>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /**
   * The answer this box is part of, whose problems it shows. A group of boxes that make one
   * answer -- a client's id and secret -- names it on one box, or each problem shows twice.
   */
  readonly field?: WizardField;
  readonly hint?: string | undefined;
  readonly secret?: boolean;
  /** Machine voice: an address, a key, a path. */
  readonly mono?: boolean;
  readonly readOnly?: boolean;
  readonly placeholder?: string;
}

export function TextField(props: TextFieldProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label className="field__caption" htmlFor={id}>
        {props.label}
      </label>
      <input
        aria-describedby={props.hint === undefined ? undefined : hintId}
        autoComplete="off"
        className={props.mono === true ? "field__box field__box--mono" : "field__box"}
        id={id}
        onChange={(event): void => props.onChange(event.currentTarget.value)}
        placeholder={props.placeholder}
        readOnly={props.readOnly}
        spellCheck={false}
        type={props.secret === true ? "password" : "text"}
        value={props.value}
      />
      {props.hint === undefined ? null : (
        <p className="field__hint" id={hintId}>
          {props.hint}
        </p>
      )}
      {props.field === undefined ? null : <FieldProblems field={props.field} />}
    </div>
  );
}

export interface Plate<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

interface PlatesProps<T extends string> {
  readonly name: string;
  readonly legend: string;
  readonly plates: readonly Plate<T>[];
  readonly chosen: T;
  readonly onChoose: (value: T) => void;
}

/** A choice of one, drawn as plates a person can read the consequences on. */
export function Plates<T extends string>(props: PlatesProps<T>): ReactNode {
  return (
    <fieldset className="plates">
      <legend className="field__caption">{props.legend}</legend>
      {props.plates.map((plate) => (
        <label
          className={plate.value === props.chosen ? "plate plate--chosen" : "plate"}
          key={plate.value}
        >
          <input
            checked={plate.value === props.chosen}
            name={props.name}
            onChange={(): void => props.onChoose(plate.value)}
            type="radio"
            value={plate.value}
          />
          <span className="plate__label">{plate.label}</span>
          {plate.hint === undefined ? null : <span className="plate__hint">{plate.hint}</span>}
        </label>
      ))}
    </fieldset>
  );
}

interface StepFrameProps {
  readonly title: string;
  readonly lead?: string | undefined;
  readonly children?: ReactNode;
  /** The buttons that end the step, right-aligned, the forward one last. */
  readonly actions: ReactNode;
}

/** One step's leaf: its title, what it asks, and the buttons that end it. */
export function StepFrame(props: StepFrameProps): ReactNode {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="leaf">
      <header className="leaf__head">
        <h1 className="leaf__title" id={titleId}>
          {props.title}
        </h1>
        {props.lead === undefined ? null : <p className="leaf__lead">{props.lead}</p>}
      </header>
      <div className="leaf__body">{props.children}</div>
      <footer className="leaf__foot">{props.actions}</footer>
    </section>
  );
}

/** Back and Continue, the pair almost every step ends with. */
export function StepNav({ extra }: { readonly extra?: ReactNode }): ReactNode {
  const t = useT();
  const back = useWizard((wizard) => wizard.back);
  const next = useWizard((wizard) => wizard.next);
  const first = useWizard(
    (wizard) => wizard.step === "language" || (wizard.reconfigure && wizard.step === "settings"),
  );
  return (
    <>
      {first ? null : (
        <button className="button button--quiet" onClick={back} type="button">
          {t("nav.back")}
        </button>
      )}
      {extra}
      <button className="button button--go" onClick={next} type="button">
        {t("nav.next")}
      </button>
    </>
  );
}
