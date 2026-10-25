// Label + control + optional hint. Pass the control as children; it is wired to
// the label through a generated id when the child is a single element.
import { Children, cloneElement, isValidElement, useId } from 'react';

export default function Field({ label, hint, className = '', children }) {
  const auto = useId();
  const only = Children.count(children) === 1 && isValidElement(children) ? children : null;
  const id = only?.props?.id || auto;
  const control = only ? cloneElement(only, { id, 'aria-describedby': hint ? `${id}-hint` : undefined }) : children;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <label htmlFor={id} className="text-[13px] font-medium text-navy-500">{label}</label>}
      {control}
      {hint && <p id={`${id}-hint`} className="text-[12.5px] text-navy-400">{hint}</p>}
    </div>
  );
}
