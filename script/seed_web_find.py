"""给网页「在记录里找」走查准备一个临时租户：40 来条分布在近两周的原话。

只允许 e2e- 开头的租户。原话用建表账号直接插入并回填录入时间（和 replay 复制原话的做法一致），
不改已有行，不碰只追加触发器。

用法（在 code/ 下）：
    .venv/bin/python ../script/seed_web_find.py --slug e2e-webfind-1
    .venv/bin/python ../script/seed_web_find.py --slug e2e-webfind-1 --drop   # 清理
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "code"))

from agentkit.envfile import load_env_file
from agentkit.tenancy import create_pool
from percolation import tenants

# (几天前, 时:分, 内容)
NOTES = [
    (13, "09:12", "报销单下周一前交给财务小林"),
    (13, "21:40", "想买千元内的 15.6 寸便携屏，CFORCE 那款 OLED 蹲到 999"),
    (12, "08:30", "陈总说新版报价单要加上运维费用那一栏"),
    (12, "12:05", "午饭：软件园南门那家潮汕牛肉粿条不错"),
    (12, "18:20", "右膝有点疼，这两周少爬楼梯"),
    (11, "10:00", "周会改到每周二上午十点"),
    (11, "16:45", "阿白推荐《置身事内》，说讲地方财政讲得很透"),
    (10, "07:50", "早上跑步 3 公里，配速 6 分半"),
    (10, "14:10", "给妈妈订的体检套餐在 11 月 28 日，美年大健康福田店"),
    (10, "22:30", "Missing Semester 第一讲看完了，shell 那部分要再刷一遍"),
    (9, "09:05", "陈总那边的合同法务还在看，预计周五回复"),
    (9, "13:30", "猫粮快没了，渴望六种鱼 5.4kg"),
    (9, "20:00", "以后说「老地方」，就是软件园南门竹里茶室靠窗座"),
    (8, "11:20", "车险 12 月 3 日到期，记得比价"),
    (8, "19:15", "周末想去深圳湾公园骑车"),
    (7, "08:40", "牙有点怕冷饮，约了瑞尔齿科复查"),
    (7, "15:00", "陈总习惯看纸质版，记得打印两份报价单"),
    (7, "21:10", "Anki 每天新卡 20 张，复习别欠账"),
    (6, "09:30", "电脑支架选了乐歌那款，等双十二"),
    (6, "17:40", "小林说报销系统换成了新的，要用企业微信登录"),
    (5, "10:15", "周四下午三点和陈总在福田站碰面，他五点要赶高铁去香港"),
    (5, "12:40", "王姐生日 12 月 9 日，她喜欢香薰"),
    (5, "23:05", "睡前别刷手机，试试 11 点半关灯"),
    (4, "08:00", "房租每月 5 号交，房东换了收款账号"),
    (4, "14:30", "竹里茶室的老板姓周，可以提前订座"),
    (4, "20:20", "想学剪辑，先看 B 站那个达芬奇入门系列"),
    (3, "09:45", "客户演示改到下周三 15:00，会议室 A3"),
    (3, "16:10", "陈总的助理叫小吴，电话在名片上"),
    (3, "21:50", "便携屏降到 1049 了，再等等"),
    (2, "07:30", "体检前一天晚上 8 点后不要吃东西"),
    (2, "13:00", "阿白是我同事白静，她推荐的是体育西路的猫山王粤菜馆"),
    (2, "19:40", "周末大扫除：窗帘送洗、冰箱除霜"),
    (1, "09:10", "报价单终版发给陈总了，等他确认"),
    (1, "12:30", "中午试了新开的云南菜，汽锅鸡一般"),
    (1, "22:15", "右膝好多了，下周恢复跑步"),
    (0, "08:20", "今天下午记得给猫剪指甲"),
    (0, "10:40", "陈总回复了：报价没问题，下周签合同"),
    (0, "11:05", "签合同要带公章和营业执照复印件"),
]


async def seed(owner_url: str, slug: str) -> None:
    user_id = await tenants.create_tenant(owner_url, slug)
    today = datetime.now().astimezone()
    pool = await create_pool(owner_url, max_size=1)
    try:
        async with pool.connection() as conn, conn.transaction():
            for seq, (days, hm, content) in enumerate(NOTES, start=1):
                h, m = (int(x) for x in hm.split(":"))
                at = (today - timedelta(days=days)).replace(hour=h, minute=m, second=0, microsecond=0)
                await conn.execute(
                    """
                    INSERT INTO raw_messages (user_id, msg_seq, batch_id, content, captured_at)
                    VALUES (%s, %s, uuidv7(), %s, %s)
                    """,
                    (user_id, seq, content, at.astimezone(UTC)),
                )
            await conn.execute(
                "UPDATE users SET next_msg_seq = %s, pending_msg_count = %s, dirty_since = now() WHERE id = %s",
                (len(NOTES) + 1, len(NOTES), user_id),
            )
    finally:
        await pool.close()
    print(f"已建临时租户 {slug}（{user_id}），写入 {len(NOTES)} 条原话")


def main() -> None:
    parser = argparse.ArgumentParser(description="准备「在记录里找」走查用的临时租户")
    parser.add_argument("--slug", required=True, help="必须以 e2e- 开头")
    parser.add_argument("--drop", action="store_true", help="清理这个临时租户")
    args = parser.parse_args()
    if not args.slug.startswith(tenants.E2E_PREFIX):
        sys.exit("只允许 e2e- 开头的临时租户")
    db = load_env_file(ROOT / "config" / "db.env")
    owner_url = db["MIGRATE_DATABASE_URL"]
    if args.drop:
        nas = Path(load_env_file(ROOT / "config" / "storage.env").get("NAS_ROOT_DIR") or "/mnt/percolation")
        print("已清理：", asyncio.run(tenants.drop_tenant(owner_url, args.slug, nas)))
        return
    asyncio.run(seed(owner_url, args.slug))


if __name__ == "__main__":
    main()
