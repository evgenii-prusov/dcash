from __future__ import annotations

from litestar import Router, get, patch, post
from litestar.exceptions import NotFoundException, ValidationException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .household import HouseholdCtx
from .models import Category, CategoryGroup
from .schemas import (
    UNSET,
    CategoryCreate,
    CategoryGroupCreate,
    CategoryGroupOut,
    CategoryGroupPatch,
    CategoryOut,
    CategoryPatch,
)


def _cat_out(c: Category) -> CategoryOut:
    return CategoryOut(id=c.id, name=c.name, archived=c.archived, sort_order=c.sort_order)


@get("/")
async def list_categories(hh: HouseholdCtx, session: AsyncSession) -> list[CategoryGroupOut]:
    groups = (
        (
            await session.execute(
                select(CategoryGroup)
                .where(CategoryGroup.household_id == hh.id)
                .order_by(CategoryGroup.sort_order, CategoryGroup.id)
            )
        )
        .scalars()
        .all()
    )
    result = []
    for g in groups:
        cats = (
            (
                await session.execute(
                    select(Category)
                    .where(Category.group_id == g.id, Category.household_id == hh.id)
                    .order_by(Category.sort_order, Category.id)
                )
            )
            .scalars()
            .all()
        )
        result.append(
            CategoryGroupOut(
                id=g.id,
                name=g.name,
                kind=g.kind,
                sort_order=g.sort_order,
                categories=[_cat_out(c) for c in cats],
            )
        )
    return result


@post("/groups", status_code=201)
async def create_group(
    data: CategoryGroupCreate, hh: HouseholdCtx, session: AsyncSession
) -> CategoryGroupOut:
    if data.kind not in ("expense", "income"):
        raise ValidationException("kind must be 'expense' or 'income'")
    group = CategoryGroup(
        household_id=hh.id,
        name=data.name.strip(),
        kind=data.kind,
        sort_order=data.sort_order,
    )
    session.add(group)
    await session.commit()
    return CategoryGroupOut(
        id=group.id, name=group.name, kind=group.kind, sort_order=group.sort_order, categories=[]
    )


@patch("/groups/{group_id:int}")
async def patch_group(
    group_id: int, data: CategoryGroupPatch, hh: HouseholdCtx, session: AsyncSession
) -> CategoryGroupOut:
    group = (
        await session.execute(
            select(CategoryGroup).where(CategoryGroup.id == group_id, CategoryGroup.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if group is None:
        raise NotFoundException()
    if data.name is not UNSET:
        group.name = data.name.strip()  # type: ignore[union-attr]
    if data.sort_order is not UNSET:
        group.sort_order = data.sort_order  # type: ignore[assignment]
    await session.commit()
    cats = (
        (
            await session.execute(
                select(Category)
                .where(Category.group_id == group.id, Category.household_id == hh.id)
                .order_by(Category.sort_order, Category.id)
            )
        )
        .scalars()
        .all()
    )
    return CategoryGroupOut(
        id=group.id,
        name=group.name,
        kind=group.kind,
        sort_order=group.sort_order,
        categories=[_cat_out(c) for c in cats],
    )


@post("/", status_code=201)
async def create_category(data: CategoryCreate, hh: HouseholdCtx, session: AsyncSession) -> CategoryOut:
    group = (
        await session.execute(
            select(CategoryGroup).where(
                CategoryGroup.id == data.group_id, CategoryGroup.household_id == hh.id
            )
        )
    ).scalar_one_or_none()
    if group is None:
        raise NotFoundException("Category group not found")
    cat = Category(
        household_id=hh.id,
        group_id=data.group_id,
        name=data.name.strip(),
        archived=False,
        sort_order=data.sort_order,
    )
    session.add(cat)
    await session.commit()
    return _cat_out(cat)


@patch("/{category_id:int}")
async def patch_category(
    category_id: int, data: CategoryPatch, hh: HouseholdCtx, session: AsyncSession
) -> CategoryOut:
    cat = (
        await session.execute(
            select(Category).where(Category.id == category_id, Category.household_id == hh.id)
        )
    ).scalar_one_or_none()
    if cat is None:
        raise NotFoundException()
    if data.name is not UNSET:
        cat.name = data.name.strip()  # type: ignore[union-attr]
    if data.archived is not UNSET:
        cat.archived = data.archived  # type: ignore[assignment]
    if data.sort_order is not UNSET:
        cat.sort_order = data.sort_order  # type: ignore[assignment]
    if data.group_id is not UNSET:
        target_group = (
            await session.execute(
                select(CategoryGroup).where(
                    CategoryGroup.id == data.group_id, CategoryGroup.household_id == hh.id
                )
            )
        ).scalar_one_or_none()
        if target_group is None:
            raise NotFoundException("Category group not found")
        cat.group_id = data.group_id  # type: ignore[assignment]
    await session.commit()
    return _cat_out(cat)


categories_router = Router(
    path="/api/categories",
    route_handlers=[list_categories, create_group, patch_group, create_category, patch_category],
)
