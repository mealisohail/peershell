// Six-digit code input with a dash between digits 3 and 4. White rounded
// boxes, accent focus ring, large mono digits. Auto-advance, backspace
// navigates back, arrow keys move, paste accepts a 6-digit run.
import "../styles/code-input.css";

const CODE_LEN = 6;

export type CodeInputOptions = {
  onChange?: (code: string) => void;
  onSubmit?: (code: string) => void;
};

export type CodeInputController = {
  getValue(): string;
  setValue(value: string): void;
  clear(): void;
  focus(): void;
  setDisabled(disabled: boolean): void;
};

export function mountCodeInput(
  host: HTMLElement,
  opts: CodeInputOptions = {},
): CodeInputController {
  host.innerHTML = "";
  host.className = `code-input ${host.className}`.trim();

  const left = makeGroup();
  const dash = document.createElement("span");
  dash.className = "code-input__dash";
  dash.setAttribute("aria-hidden", "true");
  dash.textContent = "–";
  const right = makeGroup();

  host.appendChild(left);
  host.appendChild(dash);
  host.appendChild(right);

  const inputs: HTMLInputElement[] = [];
  for (const group of [left, right]) {
    for (let i = 0; i < 3; i++) {
      const input = document.createElement("input");
      input.className = "code-input__digit";
      input.type = "text";
      input.inputMode = "numeric";
      input.autocomplete = "one-time-code";
      input.maxLength = 1;
      input.setAttribute(
        "aria-label",
        `Digit ${group === left ? i + 1 : i + 4} of 6`,
      );
      group.appendChild(input);
      inputs.push(input);
    }
  }

  function current(): string {
    return inputs.map((i) => i.value).join("");
  }

  function focusAt(i: number): void {
    const target = inputs[Math.max(0, Math.min(inputs.length - 1, i))];
    target?.focus();
    target?.select();
  }

  function emitChange(): void {
    const value = current();
    opts.onChange?.(value);
    if (value.length === CODE_LEN) {
      opts.onSubmit?.(value);
    }
  }

  inputs.forEach((input, idx) => {
    input.addEventListener("input", () => {
      const digit = input.value.replace(/[^0-9]/g, "").slice(0, 1);
      input.value = digit;
      if (digit) input.classList.add("is-filled");
      else input.classList.remove("is-filled");
      if (digit && idx < inputs.length - 1) {
        focusAt(idx + 1);
      }
      emitChange();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && idx > 0) {
        focusAt(idx - 1);
        return;
      }
      if (e.key === "ArrowLeft" && idx > 0) {
        e.preventDefault();
        focusAt(idx - 1);
        return;
      }
      if (e.key === "ArrowRight" && idx < inputs.length - 1) {
        e.preventDefault();
        focusAt(idx + 1);
        return;
      }
      if (e.key === "Enter" && current().length === CODE_LEN) {
        opts.onSubmit?.(current());
      }
    });
    input.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text") ?? "";
      const digits = text.replace(/[^0-9]/g, "").slice(0, CODE_LEN);
      if (!digits) return;
      e.preventDefault();
      for (let i = 0; i < CODE_LEN; i++) {
        const ch = digits[i] ?? "";
        const cell = inputs[i]!;
        cell.value = ch;
        cell.classList.toggle("is-filled", !!ch);
      }
      focusAt(Math.min(digits.length, CODE_LEN - 1));
      emitChange();
    });
    input.addEventListener("focus", () => input.select());
  });

  focusAt(0);

  return {
    getValue: current,
    setValue: (value) => {
      const digits = value.replace(/[^0-9]/g, "").slice(0, CODE_LEN);
      for (let i = 0; i < CODE_LEN; i++) {
        const ch = digits[i] ?? "";
        const cell = inputs[i]!;
        cell.value = ch;
        cell.classList.toggle("is-filled", !!ch);
      }
    },
    clear: () => {
      for (const i of inputs) {
        i.value = "";
        i.classList.remove("is-filled");
      }
      focusAt(0);
    },
    focus: () => focusAt(0),
    setDisabled: (disabled) => {
      for (const i of inputs) i.disabled = disabled;
    },
  };
}

function makeGroup(): HTMLDivElement {
  const g = document.createElement("div");
  g.className = "code-input__group";
  return g;
}
