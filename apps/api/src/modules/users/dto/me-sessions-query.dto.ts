import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';

/** Query of `GET /api/v1/me/sessions`: `page` (from 1) and `pageSize` (default 20, at most 50). */
export class MeSessionsQueryDto extends PageQueryDto {}
