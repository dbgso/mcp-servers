# ポリモーフィズムの活用

条件分岐（if/switch）ではなくポリモーフィズムを使い、不要な分岐を作らない。

## 悪い例

```typescript
// ❌ オプショナルメソッド + null チェック
interface TaskState {
  getEntryMessage?(task: Task): string;  // オプショナル
}

// 呼び出し側で分岐が必要
const message = state.getEntryMessage
  ? state.getEntryMessage(task)
  : "";

// ❌ 型による分岐
if (status === "pending_review") {
  return getPendingReviewMessage(task);
} else if (status === "in_progress") {
  return getInProgressMessage(task);
}
```

## 良い例

```typescript
// ✅ 必須メソッド + デフォルト実装
interface TaskState {
  getEntryMessage(task: Task): string;  // 必須
}

// メッセージ不要な状態は空文字を返す
class PendingState implements TaskState {
  getEntryMessage(_task: Task): string {
    return "";
  }
}

// メッセージが必要な状態は実装
class PendingReviewState implements TaskState {
  getEntryMessage(task: Task): string {
    return `🛑 STOP - Task "${task.id}" needs review...`;
  }
}

// 呼び出し側は分岐不要
const message = stateRegistry[status].getEntryMessage(task);
```

## 理由

- 呼び出し側のコードがシンプルになる
- 新しい状態を追加しても呼び出し側の変更が不要
- TypeScript が実装漏れを検出できる
