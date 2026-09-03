// Tone metadata refresh tests
//
// refreshToneMetadata (the UI's best-effort background sync on expanding a
// block): merges a fresh /tones/{id} API payload into every block holding
// that tone. These pin the contracts:
//
//   - fresh metadata (title, counts, url) lands on every matching block in
//     both lanes, while each block's stored models array survives untouched
//     (it carries the active model's model_url, which retries/reloads need),
//   - it is purely a metadata write: no undo step, and the revision only
//     bumps when something actually changed (an identical payload no-ops),
//   - mismatched tone ids, invalid payloads and local (drop-loaded) tones
//     are all silent no-ops.
#include "Processor.h"
#include "chain_test_helpers.h"

#include <gtest/gtest.h>

namespace {

// A fresh /tones/{id}-style payload whose models array deliberately names a
// model the block does NOT store, so "stored models survive" can't pass
// vacuously.
juce::String freshPayload(int toneId, const juce::String& title, int downloads,
                          int favorites = 0, bool isFavorite = false) {
  return "{\"id\":" + juce::String(toneId) + ",\"title\":\"" + title +
         "\",\"format\":\"ir\",\"downloads_count\":" + juce::String(downloads) +
         ",\"favorites_count\":" + juce::String(favorites) +
         ",\"is_favorite\":" + juce::String(isFavorite ? "true" : "false") +
         ",\"url\":\"https://tone3000.com/tones/fresh-" + juce::String(toneId) +
         "\",\"models\":[{\"id\":999,\"name\":\"served-model\","
         "\"model_url\":\"https://test.invalid/served.wav\"}]}";
}

// First tone block of a lane in the chain-state payload.
juce::var firstToneBlock(const juce::var& state, const char* laneKey) {
  if (const auto* lane = state[laneKey].getArray())
    for (const auto& item : *lane)
      if (item["kind"].toString() == "tone")
        return item;
  return {};
}

TEST(ToneRefreshTest, UpdatesMetadataAcrossLanesAndPreservesStoredModels) {
  ChainTestProcessor proc;

  // The same tone on both lanes, but with *different* active models, so the
  // per-block merge provably keeps each block's own stored models array.
  juce::ValueTree state("ChainSnapshot");
  state.setProperty("stereoEnabled", true, nullptr);
  juce::ValueTree left("ChainBlocks");
  left.appendChild(makeIrBlockTree("blk-l", 1, 100), nullptr);
  state.appendChild(left, nullptr);
  juce::ValueTree right("RightChainBlocks");
  right.appendChild(makeIrBlockTree("blk-r", 1, 101), nullptr);
  state.appendChild(right, nullptr);
  proc.restoreFromTree(state);
  ASSERT_TRUE(waitForChainLoaded(proc));

  const bool couldUndoBefore = static_cast<bool>(proc.getChainState(-1)["canUndo"]);

  EXPECT_TRUE(proc.refreshToneMetadata(freshPayload(1, "Fresh Title", 42, 7, true)));

  const juce::var after = proc.getChainState(-1);
  for (const char* laneKey : {"chain", "chainRight"}) {
    const juce::var block = firstToneBlock(after, laneKey);
    ASSERT_TRUE(block.isObject()) << laneKey;
    EXPECT_EQ(block["tone"]["title"].toString(), "Fresh Title") << laneKey;
    EXPECT_EQ(static_cast<int>(block["tone"]["downloads_count"]), 42) << laneKey;
    EXPECT_EQ(static_cast<int>(block["tone"]["favorites_count"]), 7) << laneKey;
    EXPECT_TRUE(static_cast<bool>(block["tone"]["is_favorite"])) << laneKey;
    EXPECT_EQ(block["tone"]["url"].toString(), "https://tone3000.com/tones/fresh-1") << laneKey;
    // The stored models array survives: still exactly the block's own active
    // model, not the payload's "served-model".
    const auto* models = block["tone"]["models"].getArray();
    ASSERT_NE(models, nullptr) << laneKey;
    ASSERT_EQ(models->size(), 1) << laneKey;
    EXPECT_EQ(models->getReference(0)["name"].toString(), "cab") << laneKey;
  }
  EXPECT_EQ(static_cast<int>(firstToneBlock(after, "chain")["tone"]["models"][0]["id"]), 100);
  EXPECT_EQ(static_cast<int>(firstToneBlock(after, "chainRight")["tone"]["models"][0]["id"]), 101);

  // Metadata only: the active models never moved, and no undo step appeared.
  EXPECT_EQ(static_cast<int>(firstToneBlock(after, "chain")["activeModelId"]), 100);
  EXPECT_EQ(static_cast<int>(firstToneBlock(after, "chainRight")["activeModelId"]), 101);
  EXPECT_EQ(static_cast<bool>(after["canUndo"]), couldUndoBefore);
}

TEST(ToneRefreshTest, IdenticalPayloadIsANoOp) {
  ChainTestProcessor proc;
  juce::ValueTree state("ChainSnapshot");
  juce::ValueTree left("ChainBlocks");
  left.appendChild(makeIrBlockTree("blk-a", 1, 100), nullptr);
  state.appendChild(left, nullptr);
  proc.restoreFromTree(state);
  ASSERT_TRUE(waitForChainLoaded(proc));

  ASSERT_TRUE(proc.refreshToneMetadata(freshPayload(1, "Fresh Title", 42)));
  const int revisionAfterFirst = static_cast<int>(proc.getChainState(-1)["revision"]);

  // Same payload again: nothing changed server-side, so no write, no
  // revision bump (i.e. no UI resync and no host "unsaved changes").
  EXPECT_FALSE(proc.refreshToneMetadata(freshPayload(1, "Fresh Title", 42)));
  EXPECT_EQ(static_cast<int>(proc.getChainState(-1)["revision"]), revisionAfterFirst);
}

// Naming a block refreshes that one regardless of its stored tone id: how a
// local .nam adopts the TONE3000 tone it was matched to (useLocalToneIdentity).
// The adopted block must keep playing its own stash copy, so `local` and the
// stored models array survive, and it must stay out of the id-matched sync.
TEST(ToneRefreshTest, BlockTargetedRefreshAdoptsIdentityAndStaysLocal) {
  ChainTestProcessor proc;

  auto localBlock = makeIrBlockTree("blk-local", 0, 700);
  localBlock.setProperty("toneJson",
                         "{\"id\":0,\"title\":\"my-file\",\"format\":\"ir\",\"local\":true,"
                         "\"models\":[{\"id\":700,\"name\":\"my-file\","
                         "\"model_url\":\"file:///stash/abc-123.nam\"}]}",
                         nullptr);
  juce::ValueTree state("ChainSnapshot");
  juce::ValueTree left("ChainBlocks");
  left.appendChild(makeIrBlockTree("blk-catalog", 1, 100), nullptr);
  left.appendChild(localBlock, nullptr);
  state.appendChild(left, nullptr);
  proc.restoreFromTree(state);
  ASSERT_TRUE(waitForChainLoaded(proc));

  // An unknown block id is a no-op, and the local block is untouched by the
  // ordinary id-matched path even once it holds a real tone id (below).
  EXPECT_FALSE(proc.refreshToneMetadata(freshPayload(5, "Nope", 1), "blk-missing"));

  EXPECT_TRUE(proc.refreshToneMetadata(freshPayload(5, "Real Tone", 3), "blk-local"));

  juce::var after = proc.getChainState(-1);
  const juce::var adopted = after["chain"][1];
  EXPECT_EQ(adopted["tone"]["title"].toString(), "Real Tone");
  EXPECT_EQ(static_cast<int>(adopted["tone"]["id"]), 5);
  // Playback stays local: the flag and the stash model_url both survive.
  EXPECT_TRUE(static_cast<bool>(adopted["tone"]["local"]));
  ASSERT_NE(adopted["tone"]["models"].getArray(), nullptr);
  ASSERT_EQ(adopted["tone"]["models"].getArray()->size(), 1);
  EXPECT_EQ(adopted["tone"]["models"][0]["model_url"].toString(), "file:///stash/abc-123.nam");
  EXPECT_EQ(static_cast<int>(adopted["activeModelId"]), 700);
  // The catalog block was not collateral damage.
  EXPECT_EQ(after["chain"][0]["tone"]["title"].toString(), "Test IR");

  // Now that it carries tone 5, the ordinary catalog sync must still refuse
  // to overwrite it: `local` is the guard, and adoption preserved it.
  EXPECT_FALSE(proc.refreshToneMetadata(freshPayload(5, "Impostor", 9)));
  after = proc.getChainState(-1);
  EXPECT_EQ(after["chain"][1]["tone"]["title"].toString(), "Real Tone");
}

TEST(ToneRefreshTest, MismatchedInvalidAndLocalPayloadsNoOp) {
  ChainTestProcessor proc;

  // One catalog block (tone 1) and one drop-loaded local block (tone 7).
  auto localBlock = makeIrBlockTree("blk-local", 7, 700);
  localBlock.setProperty("toneJson",
                         "{\"id\":7,\"title\":\"My Drop\",\"format\":\"ir\",\"local\":true,"
                         "\"models\":[{\"id\":700,\"name\":\"drop.wav\","
                         "\"model_url\":\"https://test.invalid/drop.wav\"}]}",
                         nullptr);
  juce::ValueTree state("ChainSnapshot");
  juce::ValueTree left("ChainBlocks");
  left.appendChild(makeIrBlockTree("blk-a", 1, 100), nullptr);
  left.appendChild(localBlock, nullptr);
  state.appendChild(left, nullptr);
  proc.restoreFromTree(state);
  ASSERT_TRUE(waitForChainLoaded(proc));

  // No block holds tone 999; garbage and id-less payloads don't parse.
  EXPECT_FALSE(proc.refreshToneMetadata(freshPayload(999, "Nobody", 1)));
  EXPECT_FALSE(proc.refreshToneMetadata("not json"));
  EXPECT_FALSE(proc.refreshToneMetadata("{\"title\":\"no id\"}"));

  // A same-id API tone must never overwrite a local (drop-loaded) one.
  EXPECT_FALSE(proc.refreshToneMetadata(freshPayload(7, "Impostor", 1)));

  const juce::var after = proc.getChainState(-1);
  EXPECT_EQ(after["chain"][0]["tone"]["title"].toString(), "Test IR");
  EXPECT_EQ(after["chain"][1]["tone"]["title"].toString(), "My Drop");
}

}  // namespace
