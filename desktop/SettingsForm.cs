using System.Runtime.InteropServices;

namespace SailwindChartroom;

/// <summary>A plain Windows settings window in the app's colours: grouped fields with OK, Cancel and Apply.</summary>
internal sealed class SettingsForm : Form
{
    // The window follows the page's light or dark mode.
    private sealed record Colours(Color Back, Color Field, Color Ink, Color Line, Color Hover, Color Accent);
    private static readonly Colours DarkColours = new(Color.FromArgb(21, 36, 42), Color.FromArgb(16, 28, 33), Color.FromArgb(232, 223, 200), Color.FromArgb(62, 78, 82), Color.FromArgb(27, 45, 52), Color.FromArgb(230, 173, 85));
    private static readonly Colours LightColours = new(Color.FromArgb(243, 243, 243), Color.White, Color.FromArgb(28, 28, 28), Color.FromArgb(173, 173, 173), Color.FromArgb(229, 229, 229), Color.FromArgb(154, 100, 16));

    private Colours colours;
    private bool dark;
    private readonly IReadOnlyList<ToolShortcut> defaults;
    private readonly List<(ToolShortcut Tool, TextBox Box)> shortcutBoxes = [];
    private readonly ComboBox theme = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 190 };
    private readonly ComboBox appearance = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 190 };
    private readonly ComboBox interfaceSize = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 190 };
    private readonly CheckBox checkUpdates = new() { Text = "Check for updates when Chartroom starts", AutoSize = true };
    private readonly AppSettings current;
    private readonly Action<AppSettings> apply;

    /// <param name="apply">Receives the settings on OK and Apply, after they have been checked.</param>
    internal SettingsForm(AppSettings current, IReadOnlyList<ToolShortcut> defaults, int windowsTextScale, Action<AppSettings> apply)
    {
        this.current = current;
        this.defaults = defaults;
        this.apply = apply;
        dark = current.Dark;
        colours = dark ? DarkColours : LightColours;
        Text = "Settings";
        Font = new Font("Segoe UI", 9f);
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(12);
        BackColor = colours.Back;
        ForeColor = colours.Ink;

        var shortcuts = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(6, 4, 6, 6) };
        shortcuts.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        shortcuts.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        foreach (var tool in current.Tools)
        {
            var box = new TextBox { Text = tool.Key.ToUpperInvariant(), MaxLength = 1, Width = 40, TextAlign = HorizontalAlignment.Center, CharacterCasing = CharacterCasing.Upper, BackColor = colours.Field, ForeColor = colours.Ink, BorderStyle = BorderStyle.FixedSingle, Margin = new Padding(12, 3, 0, 3) };
            box.Enter += (_, _) => box.SelectAll();
            shortcutBoxes.Add((tool, box));
            shortcuts.Controls.Add(new Label { Text = tool.Label, UseMnemonic = false, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 0, 3) });
            shortcuts.Controls.Add(box);
        }
        var restore = Button("Restore defaults");
        restore.Click += (_, _) =>
        {
            foreach (var (tool, box) in shortcutBoxes) box.Text = defaults.FirstOrDefault(entry => entry.Mode == tool.Mode)?.Key.ToUpperInvariant() ?? box.Text;
        };
        shortcuts.Controls.Add(restore);
        shortcuts.SetColumnSpan(restore, 2);

        Fill(theme, current.Themes.Select(choice => choice.Label), current.Themes.ToList().FindIndex(choice => choice.Id == current.Theme));
        Fill(appearance, current.Appearances.Select(choice => choice.Label), current.Appearances.ToList().FindIndex(choice => choice.Id == current.Appearance));
        Fill(interfaceSize, AppSettings.InterfaceSizes.Select(size => size == 0 ? $"Match Windows ({windowsTextScale}%)" : $"{size}%"), Array.IndexOf(AppSettings.InterfaceSizes, current.InterfaceSize));
        var display = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(6, 4, 6, 6) };
        foreach (var (label, control) in new (string, Control)[] { ("Theme", theme), ("Light or dark", appearance), ("Text and interface size", interfaceSize) })
        {
            display.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 12, 3) });
            display.Controls.Add(control);
        }

        checkUpdates.Checked = current.CheckForUpdates;
        var updates = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(6, 4, 6, 6) };
        updates.Controls.Add(checkUpdates);

        var ok = Button("OK");
        var cancel = Button("Cancel");
        var applyButton = Button("Apply");
        ok.Click += (_, _) => { if (TryApply()) Close(); };
        applyButton.Click += (_, _) => TryApply();
        cancel.DialogResult = DialogResult.Cancel;
        AcceptButton = ok;
        CancelButton = cancel;
        var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, Margin = new Padding(0, 10, 0, 0) };
        buttons.Controls.AddRange([applyButton, cancel, ok]);

        var layout = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, Dock = DockStyle.Fill };
        layout.Controls.Add(Group("Tool shortcuts", shortcuts));
        layout.Controls.Add(Group("Display", display));
        layout.Controls.Add(Group("Updates", updates));
        layout.Controls.Add(buttons);
        Controls.Add(layout);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        UseDarkTitleBar(Handle, dark);
    }

    /// <summary>Recolours the open window, for example after Apply changes light or dark.</summary>
    internal void UseAppearance(bool useDark)
    {
        if (useDark == dark) return;
        dark = useDark;
        colours = dark ? DarkColours : LightColours;
        BackColor = colours.Back;
        ForeColor = colours.Ink;
        Recolour(this);
        if (IsHandleCreated) UseDarkTitleBar(Handle, dark);
        Invalidate(true);
    }

    private void Recolour(Control parent)
    {
        foreach (Control control in parent.Controls)
        {
            control.ForeColor = colours.Ink;
            if (control is TextBox or ComboBox or System.Windows.Forms.Button) control.BackColor = colours.Field;
            else control.BackColor = colours.Back;
            if (control is System.Windows.Forms.Button button)
            {
                button.FlatAppearance.BorderColor = button.Text == "OK" ? colours.Accent : colours.Line;
                button.FlatAppearance.MouseOverBackColor = colours.Hover;
            }
            Recolour(control);
        }
    }

    private void Fill(ComboBox box, IEnumerable<string> items, int selected)
    {
        box.Items.AddRange(items.Cast<object>().ToArray());
        box.SelectedIndex = box.Items.Count == 0 ? -1 : Math.Max(0, selected);
        box.BackColor = colours.Field;
        box.ForeColor = colours.Ink;
        box.FlatStyle = FlatStyle.Flat;
    }

    private bool TryApply()
    {
        var tools = shortcutBoxes.Select(entry => entry.Tool with { Key = entry.Box.Text.Trim().ToLowerInvariant() }).ToList();
        if (AppSettings.ShortcutProblem(tools) is { } problem)
        {
            MessageBox.Show(this, problem, "Settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }
        string Pick(ComboBox box, IReadOnlyList<SettingChoice> choices, string fallback) =>
            box.SelectedIndex >= 0 && box.SelectedIndex < choices.Count ? choices[box.SelectedIndex].Id : fallback;
        apply(new AppSettings(tools, checkUpdates.Checked, AppSettings.InterfaceSizes[Math.Max(0, interfaceSize.SelectedIndex)],
            Pick(theme, current.Themes, current.Theme), Pick(appearance, current.Appearances, current.Appearance)));
        return true;
    }

    private GroupBox Group(string title, Control content)
    {
        var group = new GroupBox { Text = title, AutoSize = true, Dock = DockStyle.Fill, ForeColor = colours.Ink, Padding = new Padding(8), Margin = new Padding(0, 0, 0, 8) };
        group.Controls.Add(content);
        return group;
    }

    private Button Button(string text)
    {
        var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(80, 26), FlatStyle = FlatStyle.Flat, BackColor = colours.Field, ForeColor = colours.Ink, Margin = new Padding(6, 0, 0, 0) };
        button.FlatAppearance.BorderColor = text == "OK" ? colours.Accent : colours.Line;
        button.FlatAppearance.MouseOverBackColor = colours.Hover;
        return button;
    }

    /// <summary>Asks Windows 10 and 11 for a dark or light title bar. Older builds ignore the request.</summary>
    internal static void UseDarkTitleBar(IntPtr handle, bool dark)
    {
        int enabled = dark ? 1 : 0;
        _ = DwmSetWindowAttribute(handle, 20, ref enabled, sizeof(int));
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}
