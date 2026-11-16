using System.ComponentModel;
using RonSijm.Slopsidian.Services;

namespace RonSijm.Slopsidian.Linux;

public sealed class NativeTab : INotifyPropertyChanged
{
    private string text;
    public NativeTab(VaultDocument document)
    {
        Document = document;
        text = document.Content;
        ViewMode = InitialMode(document.File.Extension);
    }

    public VaultDocument Document { get; private set; }
    public string Text
    {
        get => text;
        set
        {
            if (text == value)
            {
                return;
            }
            text = value;
            NotifyChanged();
        }
    }
    public string Path => Document.File.Path;
    public string Name => Document.File.Basename;
    public bool IsDirty => text != Document.Content;
    public string Header => Name + (IsDirty ? " *" : "");
    public int Caret { get; set; }
    public double ScrollOffset { get; set; }
    public string ViewMode { get; set; }
    public bool Reading { get => ViewMode == "reading"; set => ViewMode = value ? "reading" : "source"; }
    public static string InitialMode(string extension) => extension.Equals("canvas", StringComparison.OrdinalIgnoreCase) ? "canvas" : "source";
    public bool Pinned { get; set; }
    public bool ExternalChange { get; set; }
    public event PropertyChangedEventHandler? PropertyChanged;

    public void AcceptSaved(VaultDocument document)
    {
        Document = document;
        ExternalChange = false;
        NotifyChanged();
    }

    public void Reload(VaultDocument document)
    {
        Document = document;
        text = document.Content;
        Caret = Math.Min(Caret, text.Length);
        ExternalChange = false;
        NotifyChanged();
    }

    private void NotifyChanged()
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Text)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsDirty)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Header)));
    }
}
