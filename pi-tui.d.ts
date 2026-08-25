// Ambient declaration for the slice of @earendil-works/pi-tui the /oh-my-posh editor uses.
// The real module is injected by the pi runtime; this exists only so the extension
// type-checks without a build-time dependency (same self-contained-typings convention as
// pi-oh-my-posh.ts). Not shipped — dev/typecheck only.
declare module "@earendil-works/pi-tui" {
  export interface SettingItem {
    id: string;
    label: string;
    description?: string;
    currentValue: string;
    values?: string[];
  }
  export interface SettingsListTheme {
    label: (text: string, selected: boolean) => string;
    value: (text: string, selected: boolean) => string;
    description: (text: string) => string;
    cursor: string;
    hint: (text: string) => string;
  }
  export class SettingsList {
    constructor(
      items: SettingItem[],
      maxVisible: number,
      theme: SettingsListTheme,
      onChange: (id: string, newValue: string) => void,
      onCancel: () => void,
      options?: { enableSearch?: boolean },
    );
    updateValue(id: string, newValue: string): void;
    render(width: number): string[];
    handleInput(data: string): void;
    invalidate(): void;
  }
}
