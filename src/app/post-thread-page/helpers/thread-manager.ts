export type Post = {
  PostHashHex: string;
  Comments: Post[] | null;
  CommentCount: number;
  IsHidden: boolean;
};

export type Thread = {
  parent: Post;
  children: Post[];
};

/**
 * A simple comment tree walker. Passes each comment in the tree to the given
 * callback.
 */
const walkSubcomments = (subComment: Post, cb: Function) => {
  cb(subComment);
  if (Array.isArray(subComment?.Comments)) {
    // At each nested level we only take the first comment since it doesn't make
    // sense to flatten at every level. We just want the most relevant reply to
    // each child comment.
    walkSubcomments(subComment.Comments[0], cb);
  }
};

/**
 * Takes a tree of comments and flattens it to a linear thread for
 * rendering in the UI.
 */
export function flattenThread(parent: Post): Thread {
  let thread = {
    parent,
    children: [],
  };

  if (Array.isArray(parent.Comments)) {
    parent.Comments.forEach((comment) => {
      walkSubcomments(comment, (subComment) => {
        thread.children.push(subComment);
      });
    });
  }

  return thread;
}

/**
 * Maintains a map of comment threads keyed by the parent comment PostHashHex.
 * Encapsulates the core logic of appending, prepending, and replying to
 * comments, as well as managing the reply counts getting incremented and
 * decremented. The internal data is leveraged for displaying threads in a
 * linear fashion similar to twitter threads.
 */
export class ThreadManager {
  // We don't want any outside sets on this
  private threadMap = new Map<string, Thread>();

  private threadArrayCache: Thread[];

  get threadCount(): number {
    return this.threadMap.size;
  }

  get threads(): Thread[] {
    if (this.threadArrayCache) {
      return this.threadArrayCache;
    }
    this.threadArrayCache = Array.from(this.threadMap.values());

    return this.threadArrayCache;
  }

  constructor(rootPost: Post) {
    this.addThreads(rootPost.Comments);
  }

  getThread(parentPostHashHex: string): Thread | undefined {
    return this.threadMap.get(parentPostHashHex);
  }

  removeThread(parentPostHashHex: string) {
    if (this.threadArrayCache) {
      this.threadArrayCache = undefined;
    }

    this.threadMap.delete(parentPostHashHex);
  }

  addThreads(comments: Post[]) {
    if (!Array.isArray(comments)) {
      return;
    }

    comments.forEach((comment) => {
      this.appendComment(comment);
    });
  }

  prependComment(comment: Post) {
    const currentThreads = this.threads;

    if (this.threadArrayCache) {
      this.threadArrayCache = undefined;
    }

    this.threadMap = new Map();
    this.threadMap.set(comment.PostHashHex, flattenThread(comment));
    currentThreads.forEach((thread) => {
      this.threadMap.set(thread.parent.PostHashHex, thread);
    });
  }

  appendComment(comment: Post) {
    if (this.threadArrayCache) {
      this.threadArrayCache = undefined;
    }

    this.threadMap.set(comment.PostHashHex, flattenThread(comment));
  }

  /**
   * The logic here does something close to how twitter threading works.
   * 1. If replying to a top level post it starts a new thread and shows
   *    the new reply prepended to the list of replies in the UI.
   * 2. If replying to a sub-reply that is the last child in the thread tree,
   *    it will increment the sub-reply's reply count and render the new
   *    reply as the new leaf node in the reply chain.
   * 3. If replying to either a thread parent or a thread intermediate child,
   *    it will increment the count of the parent being replied to but it does
   *    not render the new reply in the UI.
   *
   * NOTE: It is annoying that we need to do all of these shallow copies on the
   * thread parent to get things to re-render. Will have to dig deeper into the
   * rendering logic to understand exactly why this is necessary.
   */
  addReplyToComment(threadPostHashHex: string, replyingToComment: Post, reply: Post) {
    const thread = this.threadMap.get(threadPostHashHex);
    const lastChild = thread.children.length ? thread.children[thread.children.length - 1] : null;

    if (replyingToComment.PostHashHex === threadPostHashHex && !lastChild) {
      // increment the parent count && push its first child
      thread.parent = {
        ...thread.parent,
        CommentCount: thread.parent.CommentCount + 1,
      };
      thread.children = [reply];
    } else if (replyingToComment.PostHashHex === lastChild?.PostHashHex) {
      // increment count for reply parent and push a new last node
      const prevLastChild = {
        ...lastChild,
        CommentCount: lastChild.CommentCount + 1,
      };
      thread.parent = { ...thread.parent };
      thread.children = [...thread.children.slice(0, thread.children.length - 1), prevLastChild, reply];
    } else if (replyingToComment.PostHashHex === threadPostHashHex) {
      // we've replied to a thread parent that already has replies. We
      // just increment its count
      thread.parent = {
        ...thread.parent,
        CommentCount: thread.parent.CommentCount + 1,
      };
    } else {
      // we must have replied to something in the middle of a thread. just
      // increment the reply parent's count.
      const replaceNode = {
        ...replyingToComment,
        CommentCount: replyingToComment.CommentCount + 1,
      };
      const indexToReplace = thread.children.findIndex((child) => child.PostHashHex === replyingToComment.PostHashHex);
      thread.parent = { ...thread.parent };
      thread.children = [
        ...thread.children.slice(0, indexToReplace),
        replaceNode,
        ...thread.children.slice(indexToReplace + 1, thread.children.length),
      ];
    }
  }

  /**
   *  Sets the IsHidden field on the hidden post and decrements its parent's
   *  CommentCount
   */
  hideComment(commentToHide: Post, parentComment: Post, threadPostHashHex: string) {
    const thread = this.getThread(threadPostHashHex);
    commentToHide.IsHidden = true;
    if (parentComment.PostHashHex === threadPostHashHex) {
      thread.parent = {
        ...thread.parent,
        CommentCount: thread.parent.CommentCount - 1,
      };
    } else {
      const indexToDecrement = thread.children.findIndex((child) => child.PostHashHex === parentComment.PostHashHex);
      thread.children[indexToDecrement] = {
        ...thread.children[indexToDecrement],
        CommentCount: thread.children[indexToDecrement].CommentCount - 1,
      };
    }
  }

  /**
   * Dumps any existing threads and busts the array cache.
   */
  reset() {
    this.threadMap = new Map();
    this.threadArrayCache = undefined;
  }
}
