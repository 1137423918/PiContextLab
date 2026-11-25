"""Shared plain-text and link contract for the two role-specific briefs."""
import re
import unicodedata


def normalized(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


def phrases(data, role):
    result = ['项目经历', '开源贡献（已提交）', '正式 PR #2930', '实现、测试与保留问题', 'PR 状态快照', '项目经历附件 / 1', data['name'], data['date'], role['heading'], role['summary'], data['paper']['title'],
              data['paper']['detail'], data['paper']['doi'], data['footer'], data['pr_snapshot']]
    for project in role['projects']:
        result += [project['title'], project['stack'], *[b['text'] for b in project['bullets']], project['result']['text']]
    result += [role['contribution'][k] for k in ['title','text','status']]
    return result


def expected_links(data, role):
    return {data['github'],data['project_url'],data['paper']['url'],
            *[link['url'] for project in role['projects'] for link in project['links']],
            role['contribution']['url'],role['contribution']['evidence_url']}
