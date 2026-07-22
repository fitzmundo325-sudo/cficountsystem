from flask import Blueprint, render_template, request, flash, redirect, url_for, session
from .models import User
from .audit import log_audit_event
from werkzeug.security import check_password_hash
from flask_login import login_user, logout_user, login_required, current_user
from datetime import datetime, date, timezone

auth = Blueprint('auth', __name__)


@auth.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        selected_date_raw = request.form.get('date-selector')

        selected_date = date.today()
        if selected_date_raw:
            try:
                selected_date = datetime.strptime(selected_date_raw, '%Y-%m-%d').date()
            except ValueError:
                selected_date = date.today()

        user = User.query.filter_by(username=username).first()
        if user:
            if check_password_hash(user.password, password):
                flash('Logged in successfully!', category='success')
                login_user(user, remember=True) 
                user.last_activity_at = datetime.now(timezone.utc)
                user.last_login_at = user.last_activity_at
                user.last_interaction_at = None
                session['_presence_touch_epoch'] = user.last_activity_at.timestamp()
                session['login_selected_date'] = selected_date.strftime('%Y-%m-%d')
                log_audit_event(
                    action='auth.login.success',
                    entity_type='User',
                    entity_id=user.id,
                    reason='User authenticated successfully.',
                    details={
                        'selected_date': session['login_selected_date'],
                        'role': user.role,
                    },
                    actor_user=user,
                    commit=True,
                )
                
                # Redirect based on role
                if user.role in ('Superadmin', 'General Manager'):
                    return redirect(url_for('admin.dashboard'))
                else:
                    return redirect(url_for('views.home'))
            else:
                log_audit_event(
                    action='auth.login.failed',
                    entity_type='User',
                    entity_id=user.id,
                    reason='Incorrect password.',
                    details={'username': username},
                    actor_user=user,
                    commit=True,
                )
                flash('Incorrect password, try again.', category='error')
        else:
            log_audit_event(
                action='auth.login.failed',
                entity_type='User',
                entity_id=username or 'unknown',
                reason='Username does not exist.',
                details={'username': username},
                commit=True,
            )
            flash('Username does not exist.', category='error')
         
    return render_template('login.html')


@auth.route('/logout')
@login_required
def logout():
    actor = current_user
    actor.last_activity_at = None
    actor.last_interaction_at = None
    session.pop('_presence_touch_epoch', None)
    log_audit_event(
        action='auth.logout',
        entity_type='User',
        entity_id=actor.id,
        reason='User logged out.',
        details={'username': actor.username},
        actor_user=actor,
        commit=True,
    )
    logout_user()
    flash('Logged out successfully!', category='success')
    return redirect(url_for('auth.login'))

