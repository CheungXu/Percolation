-- Percolation 004 迁移：users.workspace_head 记录「派生索引对应的工作区 git 提交」。
-- 由 percolation_owner 执行，幂等可重复运行。
-- 语义：整理在暂存 worktree 写完后，在同一事务里刷新派生表、推进原话状态并写入这里，
-- 事务提交后主工作区再快进到该提交。主工作区 HEAD 落后于它说明上次快进中断，
-- 下次整理开头按它补快进。执行环境锚点把它当作「这次运行看到的工作区版本」。
-- 存量用户由 script/backfill_workspace_head.py 按当前 git HEAD 回填；整理与 reindex 开头也会懒回填。

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_head text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_workspace_head_sha') THEN
    ALTER TABLE users ADD CONSTRAINT users_workspace_head_sha
      CHECK (workspace_head IS NULL OR workspace_head ~ '^[0-9a-f]{40}$');
  END IF;
END $$;

COMMENT ON COLUMN users.workspace_head IS '派生索引对应的工作区 git 提交（40 位 sha）；整理发布事务内更新';

GRANT UPDATE (workspace_head) ON users TO percolation_app;

COMMIT;
