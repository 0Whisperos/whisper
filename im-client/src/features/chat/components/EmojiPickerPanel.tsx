import EmojiPicker, { Categories, EmojiStyle, SuggestionMode, Theme } from "emoji-picker-react";
import emojiDataZh from "emoji-picker-react/data/emojis-zh";

const categories = [
  { category: Categories.SUGGESTED, name: "最近使用" },
  { category: Categories.CUSTOM, name: "自定义表情" },
  { category: Categories.SMILEYS_PEOPLE, name: "表情与人物" },
  { category: Categories.ANIMALS_NATURE, name: "动物与自然" },
  { category: Categories.FOOD_DRINK, name: "食物与饮料" },
  { category: Categories.TRAVEL_PLACES, name: "旅行与地点" },
  { category: Categories.ACTIVITIES, name: "活动" },
  { category: Categories.OBJECTS, name: "物品" },
  { category: Categories.SYMBOLS, name: "符号" },
  { category: Categories.FLAGS, name: "旗帜" },
];

const labels = {
  searchPlaceholder: "搜索表情",
  searchLabel: "搜索表情",
  searchClear: "清除搜索",
  searchResultsNone: "没有找到表情",
  searchResultsOne: "找到一个表情",
  searchResultsMany: "找到 %n 个表情",
  categoryNavigation: "表情分类",
  reactions: "常用表情",
  expandReactions: "展开全部表情",
  loading: "正在加载表情",
  loadingError: "表情加载失败",
  retryLoading: "重试",
  skinToneNeutral: "默认肤色",
  skinToneLight: "浅肤色",
  skinToneMediumLight: "较浅肤色",
  skinToneMedium: "中等肤色",
  skinToneMediumDark: "较深肤色",
  skinToneDark: "深肤色",
};

interface EmojiPickerPanelProps {
  onSelectEmoji: (emoji: string) => void;
}

export default function EmojiPickerPanel({ onSelectEmoji }: EmojiPickerPanelProps) {
  return (
    <EmojiPicker
      className="auth-emoji-picker-surface"
      emojiData={emojiDataZh}
      emojiStyle={EmojiStyle.NATIVE}
      theme={Theme.AUTO}
      suggestedEmojisMode={SuggestionMode.RECENT}
      categories={categories}
      labels={labels}
      height={380}
      width={320}
      previewConfig={{ showPreview: false }}
      onEmojiClick={({ emoji }) => onSelectEmoji(emoji)}
    />
  );
}
