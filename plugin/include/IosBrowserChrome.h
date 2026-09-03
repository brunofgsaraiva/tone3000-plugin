#pragma once

#include <functional>
#include <juce_gui_basics/juce_gui_basics.h>

/**
 * Navigation chrome for the in-app tone3000.com pages, iOS only.
 *
 * The OAuth flows (login, Browse) navigate the one main webview away from the
 * plugin UI to tone3000.com. On desktop the site's own `menubar=true` strip
 * carries the close button and the window keeps its title bar, so backing out
 * is always one click away. On an iPad there is no window chrome at all and
 * the site's strip does not render on every step of the sign-in flow, which
 * left the login page as a one-way door: the plugin UI was gone until the app
 * was relaunched (parity audit, 2026-09-03).
 *
 * So the app draws its own strip instead of relying on the site's: Back,
 * Forward, Reload and a Close that returns to the plugin UI. Every button is
 * 44 pt, per the HIG. Off iOS this file is never compiled in.
 */
class IosBrowserChrome final : public juce::Component {
public:
  /** Row height in points; also the minimum touch target for each button. */
  static constexpr int kHeight = 44;

  IosBrowserChrome() {
    auto add = [this](juce::Button& b, const juce::String& text, const juce::String& name) {
      b.setButtonText(text);
      b.setName(name);
      b.setTitle(name);  // VoiceOver label; the glyphs alone say nothing.
      b.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff1c1c1e));
      b.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
      addAndMakeVisible(b);
    };
    add(backButton, juce::String::charToString(0x2039), "Back");
    add(forwardButton, juce::String::charToString(0x203a), "Forward");
    add(reloadButton, juce::String::charToString(0x21bb), "Reload");
    add(closeButton, "Close", "Close");

    backButton.onClick = [this] { if (onBack) onBack(); };
    forwardButton.onClick = [this] { if (onForward) onForward(); };
    reloadButton.onClick = [this] { if (onReload) onReload(); };
    closeButton.onClick = [this] { if (onClose) onClose(); };
  }

  void paint(juce::Graphics& g) override {
    g.fillAll(juce::Colour(0xff0b0b0d));
    g.setColour(juce::Colour(0xff2c2c2e));
    g.drawHorizontalLine(getHeight() - 1, 0.0f, static_cast<float>(getWidth()));
  }

  void resized() override {
    auto row = getLocalBounds().removeFromTop(kHeight);
    backButton.setBounds(row.removeFromLeft(kHeight));
    forwardButton.setBounds(row.removeFromLeft(kHeight));
    reloadButton.setBounds(row.removeFromLeft(kHeight));
    // Close is the escape hatch; give it the far edge and a wide target.
    closeButton.setBounds(row.removeFromRight(juce::jmax(kHeight * 2, 88)));
  }

  std::function<void()> onBack, onForward, onReload, onClose;

private:
  juce::TextButton backButton, forwardButton, reloadButton, closeButton;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(IosBrowserChrome)
};
