'use client'

import { useActionState, useState } from 'react'
import {
  createParticipantAction,
  deleteParticipantAction,
  updateParticipantAction,
  type ActionState,
} from '@/app/actions/participants'
import type { Category, Gender } from '@/lib/domain/types'
import type { ParticipantWithCategories } from '@/lib/services/participants'

const categoryLabels: Record<Category, string> = {
  men: 'Masculino',
  women: 'Femenino',
  mixed: 'Mixto',
}
const categories: Category[] = ['men', 'women', 'mixed']
const initialState: ActionState = {}

function naturalCategory(gender: Gender): Category {
  return gender === 'man' ? 'men' : 'women'
}

export function ParticipantForm({
  tournamentId,
  participant,
  draft,
}: {
  tournamentId: string
  participant?: ParticipantWithCategories
  draft: boolean
}) {
  const action = participant ? updateParticipantAction : createParticipantAction
  const [state, formAction, pending] = useActionState(action, initialState)
  const [deleteState, deleteAction, deletePending] = useActionState(deleteParticipantAction, initialState)
  const initialGender = participant?.gender ?? 'man'
  const [gender, setGender] = useState<Gender>(initialGender)
  const [selected, setSelected] = useState<Category[]>(
    participant ? participant.categories : [naturalCategory(initialGender)],
  )
  const [touched, setTouched] = useState(Boolean(participant))

  function changeGender(next: Gender) {
    setGender(next)
    if (!touched) setSelected([naturalCategory(next)])
  }

  function toggleCategory(category: Category) {
    setTouched(true)
    setSelected((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    )
  }

  if (!draft && participant) {
    return (
      <article className="card">
        <h3 className="card-title">{participant.name}</h3>
        <div className="card-body">
          <p className="meta">
            {participant.gender === 'man' ? 'Hombre' : 'Mujer'} | Nivel {participant.level} |{' '}
            {participant.categories.map((category) => categoryLabels[category]).join(', ') || 'Sin inscripciones'}
          </p>
        </div>
      </article>
    )
  }

  const form = (
    <form action={formAction} className="card">
      {participant ? null : <h3 className="card-title">Nuevo participante</h3>}
      <div className="card-body">
        <input type="hidden" name={participant ? 'id' : 'tournamentId'} value={participant ? participant.id : tournamentId} />
        {participant ? <input type="hidden" name="version" value={participant.version} /> : null}
        <label>
          Nombre
          <input name="name" required defaultValue={participant?.name ?? ''} />
        </label>
        <div className="field-row">
          <label>
            Genero
            <select name="gender" value={gender} onChange={(event) => changeGender(event.target.value as Gender)}>
              <option value="man">Hombre</option>
              <option value="woman">Mujer</option>
            </select>
          </label>
          <label>
            Nivel
            <input name="level" type="number" min="1" max="5" step="1" required defaultValue={participant?.level ?? 1} />
          </label>
        </div>
        <fieldset className="fieldset--flat">
          <legend>Inscripciones</legend>
          {categories.map((category) => (
            <label key={category}>
              <input
                type="checkbox"
                name="categories"
                value={category}
                checked={selected.includes(category)}
                onChange={() => toggleCategory(category)}
                disabled={!draft}
              />
              {categoryLabels[category]}
            </label>
          ))}
        </fieldset>
        {state.error ? <p role="alert">{state.error}</p> : null}
        {state.success ? <p role="status">{state.success}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? 'Guardando...' : participant ? 'Guardar participante' : 'Agregar participante'}
        </button>
      </div>
    </form>
  )

  if (!participant) return form

  return (
    <article className="stack">
      {form}
      <form action={deleteAction}>
        <input type="hidden" name="id" value={participant.id} />
        <input type="hidden" name="version" value={participant.version} />
        {deleteState.error ? <p role="alert">{deleteState.error}</p> : null}
        <button type="submit" className="caution" disabled={deletePending}>
          {deletePending ? 'Eliminando...' : 'Eliminar participante'}
        </button>
      </form>
    </article>
  )
}
